import { beforeAll, describe, expect, test } from "bun:test";
import { MIGRATIONS } from "./migrations";

// The list itself is checkable without a database, and these are the mistakes that hurt:
// a reused id silently marks someone else's migration as done, and out-of-order ids mean
// "applied in order" isn't what happens.
test("migration ids are unique and ascending", () => {
  const ids = MIGRATIONS.map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect([...ids].sort((a, b) => a - b)).toEqual(ids);
});

test("every migration is named — the log line is what someone reads at 2am", () => {
  for (const m of MIGRATIONS) expect(m.name.trim().length).toBeGreaterThan(0);
});

// Same rules as app.test.ts: a real Postgres, and only one whose name says "test".
const DB = process.env.DATABASE_URL;
const usable = !!DB && /test/i.test(DB);

describe.skipIf(!usable)("migrate", () => {
  let sql: any;
  let migrate: (sql: any) => Promise<number[]>;
  let appliedMigrations: (sql: any) => Promise<number[]>;

  beforeAll(async () => {
    process.env.R2_ENDPOINT ??= "https://example.invalid";
    process.env.R2_ACCESS_KEY_ID ??= "test";
    process.env.R2_SECRET_ACCESS_KEY ??= "test";
    process.env.R2_BUCKET ??= "test";
    ({ sql } = await import("./db")); // importing runs the migrations once
    ({ migrate, appliedMigrations } = await import("./migrations"));
    await migrate(sql);
  });

  test("every migration in the list is recorded as applied", async () => {
    expect(await appliedMigrations(sql)).toEqual(MIGRATIONS.map((m) => m.id));
  });

  test("running again is a no-op — this is what makes it safe on every boot", async () => {
    expect(await migrate(sql)).toEqual([]);
  });

  test("the baseline actually built the schema", async () => {
    const rows: { table_name: string }[] = await sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const tables = rows.map((r) => r.table_name);
    for (const t of ["users", "projects", "blobs", "campaigns", "api_tokens", "starred_items", "project_versions"]) {
      expect(tables).toContain(t);
    }
    // The baseline still *creates* `sessions` — it records what a database had, not what it
    // wants — and migration 009 drops it, because Clerk issues and revokes its own sessions.
    // So the end state must not have it: a table of live-looking credentials that authenticate
    // nobody is worse than no table.
    expect(tables).not.toContain("sessions");
  });

  test("the columns later migrations added are there", async () => {
    const columns = async (table: string): Promise<string[]> => {
      const rows: { column_name: string }[] = await sql`
        SELECT column_name FROM information_schema.columns WHERE table_name = ${table}`;
      return rows.map((r) => r.column_name);
    };
    expect(await columns("projects")).toEqual(expect.arrayContaining(["preview", "is_public", "format"]));
    expect(await columns("project_versions")).toEqual(expect.arrayContaining(["format", "layer_count"]));
    expect(await columns("users")).toEqual(expect.arrayContaining(["clerk_id"]));
  });

  // Migration 008 had to drop this, or a Clerk sign-in could not create a row at all: there is
  // no password to put in the column any more.
  test("password_hash is nullable", async () => {
    const [row] = await sql`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'password_hash'`;
    expect(row.is_nullable).toBe("YES");
  });

  // The single-column indexes migration 007 replaced are dropped, not left alongside their
  // composites — a second index on the same prefix is pure write cost. A fresh database still
  // *creates* them in the baseline, so this also proves the drops actually ran.
  test("the indexes are the composite ones, and the superseded ones are gone", async () => {
    const rows: { indexname: string }[] = await sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        "projects_user_updated_idx",
        "projects_campaign_updated_idx",
        "projects_public_updated_idx",
        "blobs_created_idx",
        "users_clerk_id_key",
      ])
    );
    for (const gone of ["projects_user_idx", "projects_campaign_idx", "projects_public_idx"]) {
      expect(names).not.toContain(gone);
    }
  });
});
