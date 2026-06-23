const BGREMOVE_URL = import.meta.env.VITE_BGREMOVE_URL ?? "http://localhost:8000";

/**
 * Sends a dataURL to the local bgremove service (./bgremove) and returns a
 * transparent-background cut-out as a PNG dataURL. Throws if the service is unreachable.
 */
export async function removeBackground(dataUrl: string): Promise<string> {
  const res = await fetch(`${BGREMOVE_URL}/cutout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl }),
  });
  if (!res.ok) throw new Error(`bgremove ${res.status}`);
  const blob = await res.blob();
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
