// Schema migrations.
//
// The schema used to be one `initSchema()` that ran every statement on every boot, in
// `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` form. That works right up until a
// change isn't expressible as "if not exists" — a renamed column, a backfill that must run
// once, a constraint tightened on existing rows — and by then there is no record of what a
// given database has actually had done to it.
//
// So: a numbered list, applied in order, each recorded in `schema_migrations`.
//
// **Migration 001 is the whole schema as it stood before this file existed**, written
// idempotently, so an already-deployed database applies it as a no-op and a fresh one gets
// everything. From 002 onward, migrations are ordinary DDL that runs exactly once.
//
// TypeScript rather than .sql files on purpose: no statement splitter to get wrong on the
// first function body or dollar-quoted string, and the migrations ship with the code however
// the image is built.
//
// Rules for adding one:
//   • append, never renumber or edit an applied migration — the record is what a deployed
//     database has already done, and rewriting history means the two disagree silently;
//   • one concern per migration, so a failure says what failed;
//   • an id gap is fine, a duplicate id is not (asserted below).

import type { Sql } from "postgres";

export type Migration = {
  /** Ascending, unique, never reused. */
  id: number;
  name: string;
  up: (sql: Sql) => Promise<void>;
};

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "baseline",
    up: async (sql) => {
      await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`; // gen_random_uuid()
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          email         text UNIQUE NOT NULL,
          password_hash text NOT NULL,
          created_at    timestamptz NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS sessions (
          token      text PRIMARY KEY,
          user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at timestamptz NOT NULL
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS projects (
          id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name       text NOT NULL,
          doc        jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`;
      // Blobs are content-addressed (id = sha256 of the bytes) so identical images across
      // projects/users dedupe to one R2 object. Ownership is tracked per (blob, user) so a
      // GET can authorize without leaking another user's images.
      await sql`
        CREATE TABLE IF NOT EXISTS blobs (
          id           text NOT NULL,
          user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          content_type text NOT NULL,
          size         integer NOT NULL,
          created_at   timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (id, user_id)
        )`;
      // Campaigns: one message shipped across several platforms. A campaign owns a set of
      // projects that usually start as the same design adapted per format. Membership is a
      // folder, not a tag — a project belongs to at most one campaign.
      await sql`
        CREATE TABLE IF NOT EXISTS campaigns (
          id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name       text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`;
      // SET NULL, not CASCADE: deleting a campaign must never destroy the designs in it.
      await sql`
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS campaign_id uuid
          REFERENCES campaigns(id) ON DELETE SET NULL`;
      // Personal API tokens: a non-browser credential so agents (the MCP server) can reach
      // the same API without a session cookie. Only the SHA-256 hash is stored — unlike
      // `sessions.token` these are long-lived, so the plaintext must not be recoverable from
      // the DB. SHA-256 rather than argon2 because it is checked on every request and the
      // token is 32 bytes of full entropy, so there is nothing to brute-force.
      await sql`
        CREATE TABLE IF NOT EXISTS api_tokens (
          id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name         text NOT NULL,
          token_hash   text UNIQUE NOT NULL,
          created_at   timestamptz NOT NULL DEFAULT now(),
          last_used_at timestamptz
        )`;
      // Starred elements: single layers saved out of a project into a per-user collection,
      // so they can be searched and re-inserted into any other project. Stored dehydrated
      // (images as blob:<id> refs), same as project docs. `kind` mirrors layer.type for
      // cheap filtering without opening the jsonb.
      await sql`
        CREATE TABLE IF NOT EXISTS starred_items (
          id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name       text NOT NULL,
          kind       text NOT NULL,
          layer      jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`;
      // Predates project-aware favourites; kept in the baseline so a database that has been
      // running since then and a fresh one end up identical.
      await sql`ALTER TABLE starred_items ADD COLUMN IF NOT EXISTS source_project_id uuid`;
      await sql`ALTER TABLE starred_items ADD COLUMN IF NOT EXISTS source_project_name text`;
      await sql`ALTER TABLE starred_items ADD COLUMN IF NOT EXISTS last_used_at timestamptz`;
      await sql`UPDATE starred_items SET last_used_at = coalesce(last_used_at, updated_at) WHERE last_used_at IS NULL`;

      await sql`CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id)`;
      await sql`CREATE INDEX IF NOT EXISTS campaigns_user_idx ON campaigns(user_id)`;
      await sql`CREATE INDEX IF NOT EXISTS projects_campaign_idx ON projects(campaign_id)`;
      await sql`CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id)`;
      await sql`CREATE INDEX IF NOT EXISTS starred_user_idx ON starred_items(user_id)`;
      await sql`CREATE INDEX IF NOT EXISTS starred_last_used_idx ON starred_items(user_id, last_used_at DESC)`;
    },
  },
  {
    id: 2,
    name: "project previews",
    // The blob id of a small JPEG of the design, captured by the editor on save. Nullable:
    // a project an agent created has none, and the archive falls back to an icon.
    up: async (sql) => {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS preview text`;
    },
  },
  {
    id: 3,
    name: "version history",
    // Every save that changes a document files the outgoing one here first, which is what
    // makes "put it back" possible after a reload has thrown away in-memory undo.
    up: async (sql) => {
      await sql`
        CREATE TABLE IF NOT EXISTS project_versions (
          id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name       text NOT NULL,
          doc        jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS project_versions_project_idx ON project_versions(project_id, created_at DESC)`;
    },
  },
  {
    id: 4,
    name: "public projects",
    // A design a logged-out visitor is allowed to read. `DEFAULT false` is the load-bearing
    // part: every project that already exists stays private the moment this applies, and
    // publishing stays a separate, deliberate act rather than a side effect of a save.
    up: async (sql) => {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false`;
      // Partial: the public gallery only ever asks for the true rows, and on a personal
      // archive those are the minority.
      await sql`CREATE INDEX IF NOT EXISTS projects_public_idx ON projects(is_public) WHERE is_public`;
    },
  },
];

/** Guards the one mistake this design can't survive: two migrations sharing an id, where
 *  whichever ran first silently marks the other as done. Thrown at import, not at boot. */
(function assertIds() {
  const ids = MIGRATIONS.map((m) => m.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`Duplicate migration id(s): ${[...new Set(dupes)].join(", ")}`);
  if (ids.some((id, i) => i > 0 && id <= ids[i - 1])) throw new Error("Migrations must be listed in ascending id order");
})();

/** Applied ids, oldest first. Also the answer to "what has this database actually had done
 *  to it", which is the question the old boot-time DDL could not answer. */
export async function appliedMigrations(sql: Sql): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM schema_migrations ORDER BY id`;
  return rows.map((r) => Number(r.id));
}

/**
 * Brings the database up to date. Safe to run on every boot: applied migrations are skipped.
 *
 * Each migration runs inside its own transaction, so a failure leaves the database at the
 * last complete step rather than half-way through one. A session-level advisory lock keeps
 * two containers starting at once from both applying the same migration — the second waits,
 * then finds the work already recorded.
 */
export async function migrate(sql: Sql): Promise<number[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         integer PRIMARY KEY,
      name       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;

  // Arbitrary constant, shared by every instance of this app and nothing else.
  const LOCK = 8_147_231;
  await sql`SELECT pg_advisory_lock(${LOCK})`;
  try {
    const done = new Set(await appliedMigrations(sql));
    const ran: number[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await sql.begin(async (tx) => {
        await m.up(tx as unknown as Sql);
        await tx`INSERT INTO schema_migrations (id, name) VALUES (${m.id}, ${m.name})`;
      });
      console.log(`[migrate] applied ${m.id} — ${m.name}`);
      ran.push(m.id);
    }
    return ran;
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK})`;
  }
}
