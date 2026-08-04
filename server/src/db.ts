// Postgres access. No ORM — plain SQL via the `postgres` driver.
//
// The schema itself lives in migrations.ts: a numbered list applied once each and recorded,
// rather than a pile of `IF NOT EXISTS` DDL re-run on every boot. `initSchema` stays as the
// name the app calls at startup.

import postgres from "postgres";
import { migrate } from "./migrations";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

export const sql = postgres(url, {
  max: 10,
  // Without a connect timeout a Postgres that accepts the socket but never completes the
  // handshake (a restarting container, a full connection table) hangs the request forever
  // instead of failing it — including `/api/health`, whose whole job is to answer.
  connect_timeout: 10,
  // Idle connections are returned rather than held for the life of the process, so a restart
  // of Postgres doesn't leave the pool full of sockets to a server that's gone.
  idle_timeout: 30,
  // NOTICE is Postgres being chatty, and the baseline migration is nothing but chatter: a
  // dozen "already exists, skipping" objects dumped on every single boot, which is how a
  // notice that matters goes unread. Dropped at NOTICE; WARNING and above still print.
  onnotice: (notice) => {
    if (notice.severity === "NOTICE") return;
    console.warn("[pg]", notice.severity, notice.code, notice.message);
  },
});

/** Brings the database up to date. Runs on boot; a database already at the latest migration
 *  does nothing but one lookup. */
export async function initSchema(): Promise<void> {
  await migrate(sql);
}
