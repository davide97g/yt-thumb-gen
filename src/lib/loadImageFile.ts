// Reads an image File into a dataURL the browser can actually paint.
//
// iPhone photos are HEIC/HEIF, which <img> can't decode in Chrome — so those are
// converted to JPEG via heic2any (libheif WASM), dynamically imported only when a
// HEIC is uploaded so normal images don't pull in the codec.
//
// Every image the editor imports comes through here — paste, the dock's upload, an image
// layer's replace, the background picker — which is why the size cap lives here too
// (`normaliseImage`, see lib/downscale.ts) rather than at four call sites.

import { normaliseImage } from "./downscale";

const HEIC_EXT = /\.(heic|heif)$/i;

function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || (file.type === "" && HEIC_EXT.test(file.name));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function loadImageFile(file: File): Promise<string> {
  const decoded = await decode(file);
  return blobToDataUrl(await normaliseImage(decoded));
}

/** Whatever the picker handed us, as a blob the browser can decode. */
async function decode(file: File): Promise<Blob> {
  if (!isHeic(file)) return file;
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  return Array.isArray(converted) ? converted[0] : converted;
}
