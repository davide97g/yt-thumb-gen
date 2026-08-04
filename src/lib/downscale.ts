// Normalising imported images.
//
// A phone photo is 4032×3024 and lands in the document as a base64 data URL — around 24 MB of
// string for 12 megapixels nobody can see. The canvas is at most 1080×1920, and that string is
// then paid for again and again: written to IndexedDB on every autosave, re-serialised by
// `html-to-image` on every export *and* every preview capture, uploaded to R2 on save,
// re-inflated to base64 on load. One resize at the door removes all of it.
//
// The rules are deliberately conservative, because the cheapest way to ruin a design is to
// degrade its source material:
//   • `MAX_SIDE` is 2560 — 2.3× the longest edge any format has, so a background can still be
//     zoomed or cropped into without showing its pixels;
//   • an image already inside the cap and under `SKIP_BYTES` is passed through **untouched**,
//     byte for byte. Brand marks, logo lockups and small cut-outs are never re-encoded;
//   • transparency survives: an image with a single non-opaque pixel is re-encoded as PNG, so a
//     cut-out stays a cut-out. Only opaque images become JPEG;
//   • if the re-encode comes out bigger than the original, the original wins.
//
// This applies to what arrives from now on. Documents already saved keep whatever they hold —
// there is no rewriting of someone's stored artwork on load.

/** Longest edge an imported image is allowed to keep. */
export const MAX_SIDE = 2560;
/** Under this, an in-cap image isn't worth re-encoding. */
export const SKIP_BYTES = 2 * 1024 * 1024;
/** Quality for the opaque case. 0.9 is above the point where a photographic background shows
 *  artefacts at export size, and well below what a phone camera spends on the same picture. */
export const JPEG_QUALITY = 0.9;

export type Plan =
  /** Hand the original bytes through unchanged. */
  | { kind: "keep" }
  /** Re-encode at these dimensions (equal to the source when only the encoding is at fault). */
  | { kind: "encode"; w: number; h: number };

/**
 * What to do with an image of this size and weight. Pure, so the policy is testable without a
 * canvas: the DOM half of this module is glue, this is the part with decisions in it.
 */
export function planDownscale(
  width: number,
  height: number,
  bytes: number,
  { maxSide = MAX_SIDE, skipBytes = SKIP_BYTES }: { maxSide?: number; skipBytes?: number } = {}
): Plan {
  // A decoder that reported nothing useful is not something to act on.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return { kind: "keep" };

  const longest = Math.max(width, height);
  const overSize = longest > maxSide;
  const overWeight = bytes > skipBytes;
  if (!overSize && !overWeight) return { kind: "keep" };

  // Within the cap but heavy: same pixels, better encoding (a 12 MB PNG of a photograph).
  if (!overSize) return { kind: "encode", w: Math.round(width), h: Math.round(height) };

  const ratio = maxSide / longest;
  return { kind: "encode", w: Math.max(1, Math.round(width * ratio)), h: Math.max(1, Math.round(height * ratio)) };
}

/** True if any pixel is less than fully opaque. Early-exits, which is why the scan is ordered
 *  from the top-left: a cut-out is transparent at its corners and answers within a few rows,
 *  while a fully opaque image is the case that has to be walked and also the case that gets the
 *  cheaper answer (JPEG) at the end of it. */
function hasAlpha(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}

type Canvas2D = { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D };

function makeCanvas(w: number, h: number): Canvas2D | null {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    return ctx ? { canvas, ctx } : null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

function encode(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Returns the blob to actually store: the original when it's already reasonable, a re-encoded
 * copy otherwise. Never throws and never returns something worse than what it was given —
 * an import failing because a resize failed would be a bad trade.
 */
export async function normaliseImage(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const plan = planDownscale(bitmap.width, bitmap.height, blob.size);
      if (plan.kind === "keep") return blob;

      const surface = makeCanvas(plan.w, plan.h);
      if (!surface) return blob;
      const { canvas, ctx } = surface;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, plan.w, plan.h);

      // Asked of the *drawn* pixels rather than the source's MIME type: a PNG is usually opaque
      // and a JPEG can't carry alpha at all, so the file extension is a bad proxy for the one
      // thing that matters — whether flattening this image would destroy a cut-out.
      const alpha = hasAlpha(ctx.getImageData(0, 0, plan.w, plan.h).data);
      const encoded = alpha ? await encode(canvas, "image/png", 1) : await encode(canvas, "image/jpeg", JPEG_QUALITY);
      if (!encoded || encoded.size === 0) return blob;
      // A small PNG cut-out can re-encode larger than it arrived; keep whichever is smaller,
      // unless we actually shed pixels, in which case the smaller image is the point.
      const shrank = plan.w < bitmap.width || plan.h < bitmap.height;
      return !shrank && encoded.size >= blob.size ? blob : encoded;
    } finally {
      bitmap.close?.();
    }
  } catch {
    return blob;
  }
}
