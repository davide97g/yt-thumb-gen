import { toPng } from "html-to-image";

const B64_PREFIX = "data:image/png;base64,";

export type ExportSize = { w: number; h: number; maxBytes?: number; platform: string };

const FALLBACK_NAME = "thumb.png";

/** Export file name derived from the open project's name, so a project called
 *  "stop-reading-code" downloads as `stop-reading-code.png` with no typing. Untitled
 *  projects (and names that sanitise down to nothing) keep the generic fallback. */
export function defaultFileName(projectName: string): string {
  const slug = projectName
    .trim()
    .replace(/[/\\:*?"<>|]+/g, "-") // characters no filesystem wants
    .replace(/\s+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!slug || slug.toLowerCase() === "senza-titolo") return FALLBACK_NAME;
  return slug.toLowerCase().endsWith(".png") ? slug : `${slug}.png`;
}

/** Captures the canvas node at the doc's exact format size and downloads it.
 *  Returns a warning if the platform has a hard size limit and the PNG exceeds it. */
export async function exportThumb(node: HTMLElement, fileName = FALLBACK_NAME, size: ExportSize): Promise<{ warning?: string }> {
  const prevTransform = node.style.transform;
  node.style.transform = "none"; // capture unscaled
  try {
    const dataUrl = await toPng(node, { width: size.w, height: size.h, pixelRatio: 1, cacheBust: true });
    const bytes = Math.ceil(((dataUrl.length - B64_PREFIX.length) * 3) / 4);
    const name = fileName.trim() || FALLBACK_NAME;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = name.toLowerCase().endsWith(".png") ? name : `${name}.png`;
    a.click();
    if (size.maxBytes && bytes > size.maxBytes) {
      const limitMb = (size.maxBytes / 1024 / 1024).toFixed(0);
      return { warning: `PNG da ${(bytes / 1024 / 1024).toFixed(1)} MB — oltre il limite ${size.platform} di ${limitMb} MB. Semplifica lo sfondo o riduci la foto.` };
    }
    return {};
  } finally {
    node.style.transform = prevTransform;
  }
}
