// Reads an image File into a dataURL the browser can actually paint.
//
// iPhone photos are HEIC/HEIF, which <img> can't decode in Chrome — so those are
// converted to JPEG via heic2any (libheif WASM), dynamically imported only when a
// HEIC is uploaded so normal images don't pull in the codec.

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
  if (!isHeic(file)) return blobToDataUrl(file);
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  return blobToDataUrl(Array.isArray(converted) ? converted[0] : converted);
}
