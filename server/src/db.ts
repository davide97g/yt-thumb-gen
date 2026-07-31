// Postgres access. No ORM — plain SQL via the `postgres` driver.
//
// The schema itself lives in migrations.ts: a numbered list applied once each and recorded,
// rather than a pile of `IF NOT EXISTS` DDL re-run on every boot. `initSchema` stays as the
// name the app calls at startup.

import postgres from "postgres";
import { migrate } from "./migrations";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

export const sql = postgres(url, { max: 10 });

/** Brings the database up to date. Runs on boot; a database already at the latest migration
 *  does nothing but one lookup. */
export async function initSchema(): Promise<void> {
  await migrate(sql);
}
