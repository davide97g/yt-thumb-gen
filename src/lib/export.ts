import { toJpeg, toPng } from "html-to-image";

const B64_PREFIX_LEN = "data:image/png;base64,".length;

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
  // "senza-titolo" stays in the list: projects saved before the UI moved to English.
  if (!slug || ["untitled", "senza-titolo"].includes(slug.toLowerCase())) return FALLBACK_NAME;
  return slug.toLowerCase().endsWith(".png") ? slug : `${slug}.png`;
}

/** Byte length of a base64 data URL's payload, without decoding it. */
export const dataUrlBytes = (dataUrl: string): number => Math.ceil(((dataUrl.length - B64_PREFIX_LEN) * 3) / 4);

/** Renders one encoding of the canvas. Injected so the fitting ladder is testable without a
 *  DOM; `quality` is only meaningful for JPEG. */
export type Encoder = (kind: "png" | "jpeg", quality?: number) => Promise<string>;

export type Encoded = { dataUrl: string; bytes: number; kind: "png" | "jpeg"; quality?: number };

/** Tried in order. 0.92 is indistinguishable at thumbnail size; 0.55 is where flat brand
 *  colours start to band, so there's no point going lower. */
const JPEG_LADDER = [0.92, 0.8, 0.68, 0.55];

/** PNG, unless PNG doesn't fit — then the highest-quality JPEG that does.
 *
 *  YouTube rejects thumbnails over 2 MB and a photo-backed design blows past that easily.
 *  Telling the user "too big, simplify your background" was technically true and useless:
 *  the fix is a file format, not a design change. Nothing about a thumbnail needs lossless.
 *
 *  Returns the smallest encoding tried when even the floor is too big — the caller decides
 *  whether to warn, but downloading something beats downloading nothing. */
export async function fitToLimit(encode: Encoder, maxBytes?: number): Promise<Encoded> {
  const png = await encode("png");
  const first: Encoded = { dataUrl: png, bytes: dataUrlBytes(png), kind: "png" };
  if (!maxBytes || first.bytes <= maxBytes) return first;

  let smallest = first;
  for (const quality of JPEG_LADDER) {
    const dataUrl = await encode("jpeg", quality);
    const attempt: Encoded = { dataUrl, bytes: dataUrlBytes(dataUrl), kind: "jpeg", quality };
    if (attempt.bytes <= maxBytes) return attempt;
    if (attempt.bytes < smallest.bytes) smallest = attempt;
  }
  return smallest;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Matches the extension to what was actually encoded, so a JPEG never lands as `.png`. */
export function fileNameFor(name: string, kind: "png" | "jpeg"): string {
  const clean = name.trim() || FALLBACK_NAME;
  const ext = kind === "png" ? "png" : "jpg";
  return /\.(png|jpe?g)$/i.test(clean) ? clean.replace(/\.(png|jpe?g)$/i, `.${ext}`) : `${clean}.${ext}`;
}

/** Captures the canvas node at the doc's exact format size, re-encoding if the platform has a
 *  hard size limit, and downloads it. `note` explains a format switch; `warning` means it
 *  still doesn't fit and the design itself has to change. */
export async function exportThumb(
  node: HTMLElement,
  fileName = FALLBACK_NAME,
  size: ExportSize
): Promise<{ warning?: string; note?: string }> {
  const prevTransform = node.style.transform;
  node.style.transform = "none"; // capture unscaled
  try {
    const options = { width: size.w, height: size.h, pixelRatio: 1, cacheBust: true };
    const result = await fitToLimit(
      (kind, quality) => (kind === "png" ? toPng(node, options) : toJpeg(node, { ...options, quality })),
      size.maxBytes
    );

    const a = document.createElement("a");
    a.href = result.dataUrl;
    a.download = fileNameFor(fileName, result.kind);
    a.click();

    if (size.maxBytes && result.bytes > size.maxBytes) {
      const limit = (size.maxBytes / 1024 / 1024).toFixed(0);
      return {
        warning: `${mb(result.bytes)} even as a JPEG — still over ${size.platform}'s ${limit} MB limit. Simplify the background or shrink the photo.`,
      };
    }
    if (result.kind === "jpeg") {
      return {
        note: `Too big as a PNG for ${size.platform} — exported as JPEG at ${Math.round((result.quality ?? 0) * 100)}% quality, ${mb(result.bytes)}.`,
      };
    }
    return {};
  } finally {
    node.style.transform = prevTransform;
  }
}
