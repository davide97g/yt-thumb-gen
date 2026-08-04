// Cloudflare R2 blob storage via Bun's built-in S3 client (R2 is S3-compatible).
// Objects live under `blobs/{sha256}`; the DB row in `blobs` records ownership + metadata.

import { S3Client } from "bun";

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  throw new Error("R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are required");
}

const client = new S3Client({
  endpoint: R2_ENDPOINT,
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  bucket: R2_BUCKET,
});

const key = (id: string) => `blobs/${id}`;

export async function putBlob(id: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await client.write(key(id), bytes, { type: contentType });
}

/** Releases the bytes. Only ever called once no `blobs` row references the id (see
 *  maintenance.ts) — objects are content-addressed and therefore shared between users. */
export async function deleteBlob(id: string): Promise<void> {
  await client.delete(key(id));
}

/** True for "R2 doesn't have this key", false for anything else — a credential problem or an
 *  outage must not be reported to the caller as a missing image. Bun's S3 client surfaces the
 *  code as `NoSuchKey`; the 404 arm is there because the same condition arrives that way from
 *  a HEAD-shaped path. */
function isMissing(err: unknown): boolean {
  const e = err as { code?: string; name?: string; status?: number } | null;
  return e?.code === "NoSuchKey" || e?.code === "NotFound" || e?.status === 404;
}

/** The bytes, or null if the object isn't there.
 *
 *  One round trip, not two: this used to `exists()` first, which meant every image in an
 *  archive view paid a HEAD before its GET — and the check answered a question the GET answers
 *  anyway. The body is still buffered rather than streamed, deliberately: streaming would move
 *  a missing object from a clean 404 to a response that has already started, and 25 MB is the
 *  cap on a single blob. */
export async function getBlob(id: string): Promise<ArrayBuffer | null> {
  try {
    return await client.file(key(id)).arrayBuffer();
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}
