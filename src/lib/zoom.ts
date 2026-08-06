/** Stage zoom & pan — the *view*, never the document.
 *
 *  The stage always sizes the canvas to fit (or to `GRID_W`, in actual-size mode); this is a
 *  magnifier laid over that. `zoom` is a multiplier on whichever base scale is in force, so
 *  toggling actual size doesn't fight the magnifier, and `x`/`y` are screen pixels of offset
 *  from the stage centre — the canvas is centred by flexbox, so the identity view is `0, 0`
 *  and needs no measurement.
 *
 *  Zooming *out* past fit is not offered: fit already shows the whole design, so the floor is
 *  1 and the gesture stops there rather than shrinking a picture that's already complete.
 *
 *  The maths is here, pure, because the part worth being sure about is that the point under
 *  the cursor stays under the cursor — see `zoom.test.ts`. `App.tsx` keeps the wheel glue.
 */

export type View = { zoom: number; x: number; y: number };
export type Box = { w: number; h: number };

/** Fit, centred — the state the stage starts and returns to. */
export const FIT_VIEW: View = { zoom: 1, x: 0, y: 0 };

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A wheel event's `deltaY` in CSS pixels. Firefox reports lines (and, rarely, pages) for a
 *  real mouse wheel, so a raw `deltaY` means one notch there and a whole magnification here. */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 16; // lines
  if (deltaMode === 2) return deltaY * 400; // pages
  return deltaY;
}

/** Pixels of wheel travel to a zoom multiplier. Exponential, so zooming in and back out by
 *  the same travel lands exactly where it started, and clamped because one mouse-wheel notch
 *  is ~100px while a trackpad pinch arrives as a stream of single digits. */
export function zoomFactor(pixels: number): number {
  return Math.exp(-clamp(pixels, -50, 50) * 0.005);
}

/** How far the canvas may slide before its edge crosses the stage edge. Zero while the canvas
 *  is smaller than the stage — there is nothing off-screen to go and look at, so it stays
 *  centred rather than drifting into a corner. */
function panLimits(view: View, content: Box, stage: Box) {
  return {
    x: Math.max(0, (content.w * view.zoom - stage.w) / 2),
    y: Math.max(0, (content.h * view.zoom - stage.h) / 2),
  };
}

/** Keeps the offset inside `panLimits`. Every view this module returns has been through it. */
export function clampPan(view: View, content: Box, stage: Box): View {
  const lim = panLimits(view, content, stage);
  return { zoom: view.zoom, x: clamp(view.x, -lim.x, lim.x), y: clamp(view.y, -lim.y, lim.y) };
}

/** Scales about a point, given in pixels from the stage centre (so the centre is `0, 0`).
 *  The canvas coordinate under that point is solved for at the old zoom and pinned at the
 *  new one, which is what makes a pinch feel like it's magnifying the thing you're pointing
 *  at instead of the middle of the screen. */
export function zoomAt(view: View, content: Box, stage: Box, at: { x: number; y: number }, factor: number): View {
  const zoom = clamp(view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (zoom === view.zoom) return view;
  // Position under the cursor, in unzoomed canvas pixels from the canvas centre.
  const u = { x: (at.x - view.x) / view.zoom, y: (at.y - view.y) / view.zoom };
  return clampPan({ zoom, x: at.x - u.x * zoom, y: at.y - u.y * zoom }, content, stage);
}

/** Slides the canvas by a screen delta (already in the direction the content should move). */
export function panBy(view: View, content: Box, stage: Box, dx: number, dy: number): View {
  return clampPan({ zoom: view.zoom, x: view.x + dx, y: view.y + dy }, content, stage);
}
