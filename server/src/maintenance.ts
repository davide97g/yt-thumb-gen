// Housekeeping the app never did: rows and objects that only ever accumulated.
//
// One leak left. R2 objects were never released — deleting a project dropped the row and left
// its images paying rent indefinitely. (The other was expired session rows, which Clerk now
// owns end to end: migration 009 dropped the table and the sweep with it.)
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

/** Whether the sweep is armed. Read per call rather than at import: it makes the switch
 *  testable (the enforced path deletes rows and R2 objects, so it must not be reachable only
 *  in production), and an operator flipping it still gets the same restart-to-apply behaviour
 *  they'd get from a constant. */
export const gcMode = (): "enforce" | "dry-run" => (process.env.BLOB_GC === "enforce" ? "enforce" : "dry-run");

/** How long an unreferenced blob is left alone before it counts as garbage. */
const GRACE_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** What counts as a reference: any 64-hex run in a document's raw JSON. Deliberately broader
 *  than `blob:<id>`, so an id in a field this doesn't know about still counts — missing a
 *  reference deletes a user's photo, keeping a spare costs a few kilobytes.
 *
 *  One string, used as both a JS and a POSIX pattern (they agree on this much), so the rule
 *  can't drift between the scan and anything that documents it. */
export const BLOB_REF_PATTERN = "[0-9a-f]{64}";

/** Every 64-hex run in a chunk of JSON. The sweep does this in SQL now — see `sweepBlobs`,
 *  which must never pull every document into this process to read it — but the pattern's
 *  behaviour is worth being able to check directly. */
export function collectBlobIds(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const m of text.matchAll(new RegExp(BLOB_REF_PATTERN, "g"))) out.add(m[0]);
  return out;
}

/** Drops blob ownership rows nothing points at any more, then deletes from R2 the objects
 *  that no user references at all. Returns what it did (or would have done).
 *
 *  The reference scan runs **in the database**. It used to select `doc::text` for every project,
 *  each of their (up to thirty) versions and every starred layer, then build the reference sets
 *  here — i.e. hold every document anyone has ever saved in this process at once, as strings and
 *  again as Sets. Postgres can match the pattern where the rows already are, and only the
 *  handful of dead ids crosses the wire.
 *  // ponytail: the scan still decompresses every document every six hours. A `blob_refs` table
 *  // maintained on write would make this a join, at the cost of a rule to keep in sync. */
export async function sweepBlobs(): Promise<{ rows: number; objects: number; mode: string }> {
  const cutoff = new Date(Date.now() - GRACE_MS);
  // Every place a blob can be named, per owner: project documents, their `preview` column, past
  // versions — a restore that found its photos collected would be worse than no history at all,
  // so any future table holding a document has to join this union — and starred layers.
  // `regexp_matches(…, 'g')` in a FROM clause yields one row per match, laterally per source row.
  const dead = await sql<{ id: string; user_id: string }[]>`
    WITH refs AS (
      SELECT user_id, m[1] AS id FROM projects, regexp_matches(doc::text, ${BLOB_REF_PATTERN}, 'g') AS m
      UNION
      SELECT user_id, preview AS id FROM projects WHERE preview IS NOT NULL
      UNION
      SELECT user_id, m[1] AS id FROM project_versions, regexp_matches(doc::text, ${BLOB_REF_PATTERN}, 'g') AS m
      UNION
      SELECT user_id, m[1] AS id FROM starred_items, regexp_matches(layer::text, ${BLOB_REF_PATTERN}, 'g') AS m
    )
    SELECT b.id, b.user_id FROM blobs b
    WHERE b.created_at < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM refs r WHERE r.user_id = b.user_id AND r.id = b.id)`;
  const mode = gcMode();
  if (dead.length === 0) return { rows: 0, objects: 0, mode };

  if (mode !== "enforce") {
    console.log(`[blob-gc:dry-run] ${dead.length} unreferenced ownership rows — set BLOB_GC=enforce to collect`);
    return { rows: dead.length, objects: 0, mode };
  }

  // One statement rather than one per row: the first enforced sweep on a deployment that has
  // been running for a year is exactly the case where "a few rows" is thousands.
  const ids = dead.map((b) => b.id);
  const owners = dead.map((b) => b.user_id);
  await sql`
    DELETE FROM blobs b USING unnest(${ids}::text[], ${owners}::uuid[]) AS d(id, user_id)
    WHERE b.id = d.id AND b.user_id = d.user_id`;

  // The bytes go only when the last owner is gone: blobs are content-addressed, so two users who
  // uploaded the same image share one object. Asked after the delete rather than inside it,
  // because a statement's later CTEs can't see its own deletions.
  const orphaned = await sql<{ id: string }[]>`
    SELECT u.id FROM unnest(${[...new Set(ids)]}::text[]) AS u(id)
    WHERE NOT EXISTS (SELECT 1 FROM blobs b WHERE b.id = u.id)`;
  let objects = 0;
  for (const { id } of orphaned) {
    await deleteBlob(id)
      .then(() => {
        objects++;
      })
      .catch((err) => console.warn(`[blob-gc] R2 delete failed for ${id}`, err));
  }
  console.log(`[blob-gc] released ${dead.length} rows, ${objects} objects`);
  return { rows: dead.length, objects, mode };
}

/** Fire the sweep now and every six hours. Started only when this process is the entry
 *  point, so importing the app in tests doesn't schedule background work. */
export function startMaintenance(): void {
  const run = async () => {
    try {
      await sweepBlobs();
    } catch (err) {
      console.warn("[maintenance] sweep failed", err);
    }
  };
  // A minute after boot, so a restart loop can't turn startup into a scan storm.
  setTimeout(run, 60_000).unref?.();
  setInterval(run, SWEEP_INTERVAL_MS).unref?.();
}
