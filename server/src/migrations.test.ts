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
    for (const t of ["users", "sessions", "projects", "blobs", "campaigns", "api_tokens", "starred_items", "project_versions"]) {
      expect(tables).toContain(t);
    }
  });

  test("the columns later migrations added are there", async () => {
    const [preview] = await sql`
      SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'preview'`;
    expect(preview).toBeDefined();
  });
});
