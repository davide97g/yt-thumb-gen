// Project preview thumbnails.
//
// The archive used to be a list of names: two designs from the same campaign were
// indistinguishable without opening both. A preview is a small JPEG of the canvas,
// captured client-side on save and stored in the same R2 blob store as the images
// (referenced by bare id — see `uploadBlob`), so the rail can paint a real picture.
//
// JPEG, not PNG, on purpose: this is a lossy 320px stand-in, not the deliverable. A
// thumbnail of a thumbnail lands around 10–20 KB instead of several hundred.

import { toJpeg } from "html-to-image";
import { uploadBlob } from "./blobs";

/** Longest side of the stored preview. 320 covers a 2× retina paint of the ~150px-wide
 *  row thumbnails while staying small enough to fetch a whole archive's worth. */
const PREVIEW_MAX = 320;
const QUALITY = 0.72;

/** Captures the canvas node as a small JPEG. Same transform dance as the real export:
 *  the node is `scale()`d to fit the stage, so it has to be reset for the capture. */
export async function capturePreview(node: HTMLElement, size: { w: number; h: number }): Promise<Blob> {
  const prevTransform = node.style.transform;
  node.style.transform = "none";
  try {
    // Ratio off the longest side, so a 9:16 story shrinks to 180×320 rather than 320×569.
    const dataUrl = await toJpeg(node, {
      width: size.w,
      height: size.h,
      pixelRatio: PREVIEW_MAX / Math.max(size.w, size.h),
      quality: QUALITY,
      cacheBust: true,
      backgroundColor: "#000",
    });
    return await (await fetch(dataUrl)).blob();
  } finally {
    node.style.transform = prevTransform;
  }
}

/** Captures + uploads, returning the blob id to store on the project. Never throws: a
 *  preview is decoration, and a font that failed to inline must not cost a save. */
export async function makePreview(node: HTMLElement, size: { w: number; h: number }): Promise<string | null> {
  try {
    return await uploadBlob(await capturePreview(node, size));
  } catch {
    return null;
  }
}

/** Where the browser fetches a stored preview. Same-origin, so the session cookie rides
 *  along on a plain `<img src>`, and the API serves it `immutable` (ids are content hashes). */
export const previewUrl = (id: string): string => `/api/blobs/${id}`;
