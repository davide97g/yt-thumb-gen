// Blob offload boundary. Docs keep images as base64 data URLs *at runtime* (so the canvas
// export via html-to-image never hits cross-origin taint), but when a project is saved to the
// backend the data URLs are swapped for content-addressed refs whose bytes live in R2, and
// swapped back on load. This module is the only place that translation happens.

import type { ImageLayer, Layer, ThumbDoc } from "../state";

const REF = "blob:"; // sentinel prefix for a stored-blob reference ("blob:<sha256>")

/** Where a `blob:<id>` ref's bytes are read from. The default is the owner's authenticated
 *  route; the public gallery passes a project-scoped one, because a logged-out visitor is
 *  allowed the images of a published design and nothing else. */
export type BlobUrl = (id: string) => string;
const ownBlobUrl: BlobUrl = (id) => `/api/blobs/${id}`;

// Writes are refused here rather than only at the buttons. `uploadBlob` is the one write that
// skips the api.ts wrapper, and it runs from the preview capture *before* a save — so a guest
// mode that disabled only `saveConfig` would still fire this. See `setReadOnly` in storage.ts,
// which is the flag both modules share.
let readOnly = false;
export function setReadOnly(v: boolean) {
  readOnly = v;
}
export function assertWritable(): void {
  if (readOnly) throw new Error("Read-only session: sign in to save.");
}

const isDataUrl = (s: string | null | undefined): s is string => typeof s === "string" && s.startsWith("data:");
const isRef = (s: string | null | undefined): s is string => typeof s === "string" && s.startsWith(REF);

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then((r) => r.blob());
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Uploads raw bytes to R2 through the API and returns their content-addressed id.
 *  Exported because not every stored image belongs to a doc: project preview thumbnails
 *  ride the same blob store, referenced by bare id instead of a `blob:` ref. */
export async function uploadBlob(blob: Blob): Promise<string> {
  assertWritable();
  const res = await fetch("/api/blobs", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": blob.type || "application/octet-stream" },
    body: blob,
  });
  if (!res.ok) throw new Error(`Image upload failed (${res.status})`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

/** Upload a data URL, returning its `blob:<id>` ref. Memoized per call so a data URL reused
 *  across layers (e.g. src === origSrc) uploads once. */
async function uploadDataUrl(dataUrl: string, cache: Map<string, string>): Promise<string> {
  const hit = cache.get(dataUrl);
  if (hit) return hit;
  const ref = REF + (await uploadBlob(await dataUrlToBlob(dataUrl)));
  cache.set(dataUrl, ref);
  return ref;
}

async function fetchRef(ref: string, cache: Map<string, string>, blobUrl: BlobUrl): Promise<string> {
  const hit = cache.get(ref);
  if (hit) return hit;
  const res = await fetch(blobUrl(ref.slice(REF.length)), { credentials: "include" });
  if (!res.ok) throw new Error(`Image not found (${res.status})`);
  const dataUrl = await blobToDataUrl(await res.blob());
  cache.set(ref, dataUrl);
  return dataUrl;
}

/** The image-bearing string fields on a single layer, resolved by a mapper. */
async function mapLayerImages(l: Layer, map: (v: string) => Promise<string>): Promise<Layer> {
  if (l.type !== "image") return l;
  const img = l as ImageLayer;
  const src = img.src ? await map(img.src) : img.src;
  const origSrc = img.origSrc ? await map(img.origSrc) : img.origSrc;
  return { ...img, src, origSrc };
}

/** The image-bearing string fields on a doc, resolved in place by a mapper. */
async function mapImageFields(doc: ThumbDoc, map: (v: string) => Promise<string>): Promise<ThumbDoc> {
  const background = doc.background.image ? { ...doc.background, image: await map(doc.background.image) } : doc.background;
  const layers = await Promise.all(doc.layers.map((l) => mapLayerImages(l, map)));
  return { ...doc, background, layers };
}

/** Replace every inline data URL with a `blob:<id>` ref, uploading bytes to R2 via the API. */
export function dehydrateDoc(doc: ThumbDoc): Promise<ThumbDoc> {
  const cache = new Map<string, string>();
  return mapImageFields(doc, (v) => (isDataUrl(v) ? uploadDataUrl(v, cache) : Promise.resolve(v)));
}

/** Replace every `blob:<id>` ref with its data URL, fetching bytes from the API. `blobUrl`
 *  picks which route those bytes come from — the owner's, or a public project's. */
export function hydrateDoc(doc: ThumbDoc, blobUrl: BlobUrl = ownBlobUrl): Promise<ThumbDoc> {
  const cache = new Map<string, string>();
  return mapImageFields(doc, (v) => (isRef(v) ? fetchRef(v, cache, blobUrl) : Promise.resolve(v)));
}

/** Layer-level variants — used by the starred-elements collection, which stores single
 *  layers instead of whole docs. Same translation, same refs, same R2 objects. */
export function dehydrateLayer(layer: Layer): Promise<Layer> {
  const cache = new Map<string, string>();
  return mapLayerImages(layer, (v) => (isDataUrl(v) ? uploadDataUrl(v, cache) : Promise.resolve(v)));
}

export function hydrateLayer(layer: Layer): Promise<Layer> {
  const cache = new Map<string, string>();
  return mapLayerImages(layer, (v) => (isRef(v) ? fetchRef(v, cache, ownBlobUrl) : Promise.resolve(v)));
}
