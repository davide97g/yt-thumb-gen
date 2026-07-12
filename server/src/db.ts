// Postgres access + schema bootstrap. No ORM — plain SQL via the `postgres` driver.
// The schema is created idempotently on boot (CREATE TABLE IF NOT EXISTS), which is
// enough for this single-service app; there is no migration framework.

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

export const sql = postgres(url, { max: 10 });

export async function initSchema(): Promise<void> {
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
  // Starred elements: single layers (any type) saved out of a project into a per-user
  // collection, so they can be searched and re-inserted into any other project. The
  // layer JSON is stored dehydrated (images as blob:<id> refs, bytes in R2), same as
  // project docs. `kind` mirrors layer.type for cheap filtering without opening jsonb.
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
  // These ALTERs are deliberately idempotent: existing installations predate
  // project-aware favourites and do not have a migration runner.
  await sql`ALTER TABLE starred_items ADD COLUMN IF NOT EXISTS source_project_id uuid`;
  await sql`ALTER TABLE starred_items ADD COLUMN IF NOT EXISTS source_project_name text`;
  await sql`ALTER TABLE starred_items ADD COLUMN IF NOT EXISTS last_used_at timestamptz`;
  await sql`UPDATE starred_items SET last_used_at = coalesce(last_used_at, updated_at) WHERE last_used_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS starred_user_idx ON starred_items(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS starred_last_used_idx ON starred_items(user_id, last_used_at DESC)`;
}
