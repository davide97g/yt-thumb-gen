// Housekeeping the app never did: rows and objects that only ever accumulated.
//
// Two leaks. Sessions were deleted on explicit logout and nowhere else, so every login a user
// never logged out of stayed in the table past its expiry, forever. And R2 objects were never
// released — deleting a project dropped the row and left its images paying rent indefinitely.
//
// The blob sweep is the dangerous one, so it is built to under-delete:
//   • a blob is spared unless it is older than GRACE_MS — an image is uploaded *before* the
//     project that references it is saved, and that gap must never be fatal;
//   • references are found by scanning each document's raw JSON for any 64-hex string, which
//     over-matches on purpose. Missing a reference deletes a user's photo; keeping a spare
//     costs a few kilobytes;
//   • it is a dry run unless BLOB_GC=enforce, mirroring THUMBDOC_VALIDATE. Watch the logs
//     first, turn it on second.

import { sql } from "./db";
import { deleteBlob } from "./r2";

export const BLOB_GC = process.env.BLOB_GC === "enforce" ? "enforce" : "dry-run";

/** How long an unreferenced blob is left alone before it counts as garbage. */
const GRACE_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Every 64-hex run in a chunk of JSON. Deliberately broader than `blob:<id>`: an id that
 *  shows up in a field this doesn't know about still counts as a reference. */
export function collectBlobIds(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const m of text.matchAll(/[0-9a-f]{64}/g)) out.add(m[0]);
  return out;
}

/** Expired sessions are dead weight the moment they expire — the auth query already ignores
 *  them (`expires_at > now()`), so this only reclaims space. */
export async function sweepSessions(): Promise<number> {
  const rows = await sql`DELETE FROM sessions WHERE expires_at < now() RETURNING token`;
  return rows.length;
}

/** Drops blob ownership rows nothing points at any more, then deletes from R2 the objects
 *  that no user references at all. Returns what it did (or would have done). */
export async function sweepBlobs(): Promise<{ rows: number; objects: number; mode: string }> {
  // Referenced ids, per owner. Both places a blob can be named: project docs (plus their
  // preview column) and starred layers.
  const referenced = new Map<string, Set<string>>();
  const note = (userId: string, ids: Iterable<string>) => {
    const set = referenced.get(userId) ?? new Set<string>();
    for (const id of ids) set.add(id);
    referenced.set(userId, set);
  };

  for (const r of await sql<{ user_id: string; doc: string; preview: string | null }[]>`
    SELECT user_id, doc::text AS doc, preview FROM projects`) {
    note(r.user_id, collectBlobIds(r.doc));
    if (r.preview) note(r.user_id, [r.preview]);
  }
  for (const r of await sql<{ user_id: string; layer: string }[]>`
    SELECT user_id, layer::text AS layer FROM starred_items`) {
    note(r.user_id, collectBlobIds(r.layer));
  }

  const cutoff = new Date(Date.now() - GRACE_MS);
  const owned = await sql<{ id: string; user_id: string }[]>`
    SELECT id, user_id FROM blobs WHERE created_at < ${cutoff}`;
  const dead = owned.filter((b) => !referenced.get(b.user_id)?.has(b.id));
  if (dead.length === 0) return { rows: 0, objects: 0, mode: BLOB_GC };

  if (BLOB_GC !== "enforce") {
    console.log(`[blob-gc:dry-run] ${dead.length} unreferenced ownership rows — set BLOB_GC=enforce to collect`);
    return { rows: dead.length, objects: 0, mode: BLOB_GC };
  }

  for (const b of dead) {
    await sql`DELETE FROM blobs WHERE id = ${b.id} AND user_id = ${b.user_id}`;
  }

  // The bytes go only when the last owner is gone: blobs are content-addressed, so two users
  // who uploaded the same image share one object.
  let objects = 0;
  for (const id of new Set(dead.map((b) => b.id))) {
    const still = await sql`SELECT 1 FROM blobs WHERE id = ${id} LIMIT 1`;
    if (still.length > 0) continue;
    await deleteBlob(id).catch((err) => console.warn(`[blob-gc] R2 delete failed for ${id}`, err));
    objects++;
  }
  console.log(`[blob-gc] released ${dead.length} rows, ${objects} objects`);
  return { rows: dead.length, objects, mode: BLOB_GC };
}

/** Fire both sweeps now and every six hours. Started only when this process is the entry
 *  point, so importing the app in tests doesn't schedule background work. */
export function startMaintenance(): void {
  const run = async () => {
    try {
      const sessions = await sweepSessions();
      if (sessions > 0) console.log(`[maintenance] cleared ${sessions} expired sessions`);
      await sweepBlobs();
    } catch (err) {
      console.warn("[maintenance] sweep failed", err);
    }
  };
  // A minute after boot, so a restart loop can't turn startup into a scan storm.
  setTimeout(run, 60_000).unref?.();
  setInterval(run, SWEEP_INTERVAL_MS).unref?.();
}
