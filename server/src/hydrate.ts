// Server-side counterpart of src/lib/blobs.ts: `blob:<id>` refs back into inline data URLs.
//
// The renderer's page makes no requests of its own — it is handed a document and draws it.
// That is deliberate: it holds no session, no token and no R2 credentials, so it cannot be
// aimed at anything. The cost is that whatever hands it a document has to inline the images
// first, which is this.
//
// Ownership is enforced per blob, not per document: a doc that names someone else's blob id
// resolves to nothing rather than to their photo.

import { sql } from "./db";
import { getBlob } from "./r2";

const REF = "blob:";

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000; // btoa on the whole buffer blows the argument limit on big images
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

/** Resolves one ref for one user. Returns null when the ref isn't theirs or the bytes are
 *  gone — the caller drops the image rather than failing the whole render. */
async function resolveRef(ref: string, userId: string, cache: Map<string, string | null>): Promise<string | null> {
  const cached = cache.get(ref);
  if (cached !== undefined) return cached;

  const id = ref.slice(REF.length);
  const [row] = await sql<{ content_type: string }[]>`
    SELECT content_type FROM blobs WHERE id = ${id} AND user_id = ${userId}`;
  const bytes = row ? await getBlob(id) : null;
  const dataUrl = bytes ? `data:${row!.content_type};base64,${toBase64(new Uint8Array(bytes))}` : null;
  cache.set(ref, dataUrl);
  return dataUrl;
}

/** Every image-bearing field of a document, with `blob:` refs inlined. Shape-agnostic beyond
 *  the fields it knows, so an unrecognised layer type passes through untouched. */
export async function hydrateDocForRender(doc: any, userId: string): Promise<any> {
  const cache = new Map<string, string | null>();
  const map = async (value: unknown): Promise<unknown> =>
    typeof value === "string" && value.startsWith(REF) ? await resolveRef(value, userId, cache) : value;

  const background = doc?.background ? { ...doc.background, image: await map(doc.background.image) } : doc?.background;
  const layers = Array.isArray(doc?.layers)
    ? await Promise.all(
        doc.layers.map(async (l: any) =>
          l?.type === "image" ? { ...l, src: await map(l.src), origSrc: await map(l.origSrc) } : l
        )
      )
    : doc?.layers;

  return { ...doc, background, layers };
}
