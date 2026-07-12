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

export async function getBlob(id: string): Promise<ArrayBuffer | null> {
  const file = client.file(key(id));
  if (!(await file.exists())) return null;
  return file.arrayBuffer();
}
