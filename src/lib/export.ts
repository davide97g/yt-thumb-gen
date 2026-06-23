import { toPng } from "html-to-image";

const YT_LIMIT = 2 * 1024 * 1024; // YouTube thumbnail max 2 MB
const B64_PREFIX = "data:image/png;base64,";

/** Captures the canvas node at exact 1280×720 and downloads it. Returns a warning if over the YT size limit. */
export async function exportThumb(node: HTMLElement, fileName = "thumb.png"): Promise<{ warning?: string }> {
  const prevTransform = node.style.transform;
  node.style.transform = "none"; // capture unscaled
  try {
    const dataUrl = await toPng(node, { width: 1280, height: 720, pixelRatio: 1, cacheBust: true });
    const bytes = Math.ceil(((dataUrl.length - B64_PREFIX.length) * 3) / 4);
    const name = fileName.trim() || "thumb.png";
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = name.toLowerCase().endsWith(".png") ? name : `${name}.png`;
    a.click();
    if (bytes > YT_LIMIT) {
      return { warning: `PNG da ${(bytes / 1024 / 1024).toFixed(1)} MB — oltre il limite YouTube di 2 MB. Semplifica lo sfondo o riduci la foto.` };
    }
    return {};
  } finally {
    node.style.transform = prevTransform;
  }
}
