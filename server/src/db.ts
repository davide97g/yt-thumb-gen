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
  // SET NULL, not CASCADE: deleting a campaign must never destroy the designs in it. They
  // fall back to the ungrouped list.
  await sql`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS campaign_id uuid
      REFERENCES campaigns(id) ON DELETE SET NULL`;

  // Personal API tokens: a non-browser credential so agents (the MCP server) can reach the
  // same API without a session cookie. Only the SHA-256 hash is stored — unlike
  // `sessions.token`, these are long-lived, so the plaintext must not be recoverable from
  // the DB. SHA-256 rather than argon2 because it is checked on every request and the token
  // is 32 bytes of full entropy, so there is nothing to brute-force.
  await sql`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         text NOT NULL,
      token_hash   text UNIQUE NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz
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
  // Version history. Undo lives in the browser, holds 20 steps and dies on reload — so an
  // edit that survives a refresh was, until now, permanent. Every write that changes the
  // document files the *previous* one here first, which is what makes "put it back" possible
  // after a bad edit, a bad agent, or a week.
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

  // Preview thumbnail: the blob id of a small JPEG of the design, captured by the editor on
  // save. Nullable — projects created by an agent (or saved before previews existed) simply
  // have none, and the archive falls back to an icon.
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS preview text`;
  // These ALTERs are deliberately idempotent: existing installations predate
  // project-aware favourites and do not have a migration runner.
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
}
