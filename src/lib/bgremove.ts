const BGREMOVE_URL = import.meta.env.VITE_BGREMOVE_URL ?? "http://localhost:8000";

/**
 * Removes the background, returning a transparent-background cut-out as a PNG dataURL.
 * Local dev (`vite dev`) → the local rembg service (./bgremove).
 * Production build → in-browser model (@imgly/background-removal), no backend.
 */
export async function removeBackground(dataUrl: string): Promise<string> {
  if (import.meta.env.DEV) return removeViaService(dataUrl);
  // ponytail: AGPL lib, model served from IMG.LY's CDN; self-host via `publicPath` config if the CDN ever matters.
  // model:"isnet" = full precision (best cutout the lib offers, vs the default half-precision "isnet_fp16").
  // device:"gpu" uses WebGPU when present (no cross-origin-isolation headers needed) and falls back to CPU.
  const { removeBackground: imglyRemoveBackground } = await import("@imgly/background-removal");
  return blobToDataUrl(await imglyRemoveBackground(dataUrl, { model: "isnet", device: "gpu" }));
}

async function removeViaService(dataUrl: string): Promise<string> {
  const res = await fetch(`${BGREMOVE_URL}/cutout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl }),
  });
  if (!res.ok) throw new Error(`bgremove ${res.status}`);
  return blobToDataUrl(await res.blob());
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
