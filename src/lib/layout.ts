// Pure geometry for the editor: sticky drag-snapping and align/distribute.
// No React, no DOM — all inputs are plain numbers in 1280×720 canvas units,
// so this is unit-testable in isolation (see layout.test.ts).

export type Box = { x: number; y: number; w: number; h: number };
export type Placed = { id: string; box: Box };
export type SnapResult = { x: number; y: number; vx: number | null; hy: number | null };
export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Axis-aligned overlap test (used by marquee selection). */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** One axis of snapping. `left` is the box's start on this axis, `extent` its
 *  size; the three moving points are start / centre / end. `stickyLine` is the
 *  line we were snapped to last frame (or null). Returns the adjusted start and
 *  the active line (null = free). Hysteresis: once snapped, stay until a moving
 *  point drifts more than `brk` from the line; otherwise snap when within `snap`. */
function snapAxis(
  left: number, extent: number, lines: number[], stickyLine: number | null, snap: number, brk: number,
): { pos: number; line: number | null } {
  const pts = [left, left + extent / 2, left + extent];
  if (stickyLine != null) {
    let best = Infinity, bp = left;
    for (const p of pts) { const d = Math.abs(p - stickyLine); if (d < best) { best = d; bp = p; } }
    if (best <= brk) return { pos: left + (stickyLine - bp), line: stickyLine };
  }
  let best = Infinity, bp = left, bl: number | null = null;
  for (const p of pts) for (const L of lines) { const d = Math.abs(p - L); if (d < best) { best = d; bp = p; bl = L; } }
  if (bl != null && best <= snap) return { pos: left + (bl - bp), line: bl };
  return { pos: left, line: null };
}

/** Snap a dragged box's raw top-left to the nearest candidate lines on each axis. */
export function resolveSnap(
  raw: { x: number; y: number }, size: { w: number; h: number },
  xLines: number[], yLines: number[], sticky: { vx: number | null; hy: number | null },
  snap: number, brk: number,
): SnapResult {
  const ax = snapAxis(raw.x, size.w, xLines, sticky.vx, snap, brk);
  const ay = snapAxis(raw.y, size.h, yLines, sticky.hy, snap, brk);
  return { x: ax.pos, y: ay.pos, vx: ax.line, hy: ay.line };
}

/** New x/y for each box so the selection aligns on the given edge/centre.
 *  Only the relevant axis changes; the other coordinate is preserved. */
export function alignBoxes(items: Placed[], edge: AlignEdge): { id: string; x: number; y: number }[] {
  if (items.length === 0) return [];
  const minX = Math.min(...items.map((i) => i.box.x));
  const maxR = Math.max(...items.map((i) => i.box.x + i.box.w));
  const minY = Math.min(...items.map((i) => i.box.y));
  const maxB = Math.max(...items.map((i) => i.box.y + i.box.h));
  const cx = (minX + maxR) / 2, cy = (minY + maxB) / 2;
  return items.map(({ id, box }) => {
    let { x, y } = box;
    if (edge === "left") x = minX;
    else if (edge === "right") x = maxR - box.w;
    else if (edge === "hcenter") x = cx - box.w / 2;
    else if (edge === "top") y = minY;
    else if (edge === "bottom") y = maxB - box.h;
    else if (edge === "vcenter") y = cy - box.h / 2;
    return { id, x, y };
  });
}

/** Even out the gaps between boxes along one axis, holding the two extremes
 *  fixed. No-op for fewer than 3 items. */
export function distributeBoxes(items: Placed[], axis: "h" | "v"): { id: string; x: number; y: number }[] {
  if (items.length < 3) return items.map(({ id, box }) => ({ id, x: box.x, y: box.y }));
  const get = (b: Box) => (axis === "h" ? b.x : b.y);
  const ext = (b: Box) => (axis === "h" ? b.w : b.h);
  const sorted = [...items].sort((a, b) => get(a.box) - get(b.box));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = get(last.box) + ext(last.box) - get(first.box);
  const totalExt = sorted.reduce((sum, i) => sum + ext(i.box), 0);
  const gap = (span - totalExt) / (sorted.length - 1);
  let cursor = get(first.box);
  return sorted.map(({ id, box }) => {
    const v = cursor;
    cursor += ext(box) + gap;
    return axis === "h" ? { id, x: v, y: box.y } : { id, x: box.x, y: v };
  });
}
