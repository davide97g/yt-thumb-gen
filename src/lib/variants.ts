/** Comparing a design against its alternates — the maths, pure.
 *
 *  A variant set is a base plus up to eight alternates (see server/src/index.ts). Two questions
 *  have to be answered before anything can be drawn, and both are arithmetic worth being sure
 *  about rather than glue:
 *
 *  • **How many cells fit, at what scale.** A compare grid is n copies of one aspect ratio in
 *    one box. The naive answer — a fixed 2 or 3 columns — wastes half the stage on two YouTube
 *    frames and squeezes six Shorts into slivers, so the column count is *searched*: every
 *    candidate is measured and the one that yields the largest cell wins. One rule, six formats.
 *
 *  • **Which members get a live cell.** Every cell is a real `ThumbCanvas`, and a design with an
 *    effect background is a WebGL context — browsers cap those around sixteen, and a hydrated
 *    document carries full-resolution images inline. So the grid has a ceiling, and `visible`
 *    reports what it dropped: a comparison that silently leaves two candidates out is worse than
 *    one that says it is showing four of six.
 *
 *  `CompareView` keeps the DOM; this file keeps the decisions. See variants.test.ts.
 */

import type { VariantMember } from "./storage";

export type Box = { w: number; h: number };

/** How many designs may hold a live canvas at once. Four is also about the point where a
 *  side-by-side stops being a comparison and becomes a gallery. */
export const LIVE_CELLS = 4;

/** Gap between cells, in CSS pixels. Small: the cells are the content, and a variant grid is
 *  read by scanning across it, which whitespace slows down. */
export const CELL_GAP = 12;
/** Room under each cell for its label row (letter, verdict, name). */
export const CELL_LABEL_H = 26;

export type GridPlan = {
  cols: number;
  rows: number;
  /** Size of one canvas, in CSS pixels, aspect preserved. */
  cell: Box;
  /** Scale to hand `ThumbCanvas` — `cell.w / canvasWidth`. */
  scale: number;
};

/**
 * Lays `count` copies of one aspect ratio out in `box`, as large as they will go.
 *
 * `min` is a floor on cell width: below it the frames are too small to judge anything, so the
 * caller is better off being told to compare fewer at once than being handed thumbnails.
 * Returns the plan with the largest cell; `cols` is never more than `count`.
 */
export function planGrid(count: number, box: Box, canvas: Box, min = 120): GridPlan | null {
  if (count < 1 || box.w <= 0 || box.h <= 0) return null;
  const aspect = canvas.w / canvas.h;
  let best: GridPlan | null = null;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    // Available space per cell, gaps and label rows removed first — otherwise a plan that fits
    // on paper overflows once the labels are drawn.
    const availW = (box.w - CELL_GAP * (cols - 1)) / cols;
    const availH = (box.h - CELL_GAP * (rows - 1)) / rows - CELL_LABEL_H;
    if (availW <= 0 || availH <= 0) continue;
    // The cell is whichever of the two constraints binds.
    const w = Math.min(availW, availH * aspect);
    if (w < min) continue;
    if (!best || w > best.cell.w) best = { cols, rows, cell: { w, h: w / aspect }, scale: w / canvas.w };
  }
  return best;
}

/** What a grid can actually show, and what it had to leave out.
 *
 *  The active design is always in — it is the one being worked on — and the rest fill up in set
 *  order. `hidden` is not a rounding error to swallow: it is the sentence the UI has to print. */
export function visible<T extends { id: string }>(members: T[], activeId: string | null, limit = LIVE_CELLS): { shown: T[]; hidden: T[] } {
  if (members.length <= limit) return { shown: members, hidden: [] };
  const active = members.filter((m) => m.id === activeId);
  const shown = [...active];
  for (const m of members) {
    if (shown.length >= limit) break;
    if (!shown.includes(m)) shown.push(m);
  }
  // Set order, not selection order: the letters must read A B C across the grid whichever
  // member happens to be open.
  const keep = new Set(shown.map((m) => m.id));
  return { shown: members.filter((m) => keep.has(m.id)), hidden: members.filter((m) => !keep.has(m.id)) };
}

/** The letter a member is known by. The base carries no stored label — it is A by definition,
 *  which is what lets an existing design become the base of a set without being rewritten. */
export const labelOf = (m: Pick<VariantMember, "isBase" | "label">): string => (m.isBase ? "A" : (m.label ?? "?"));

/** True when the set is worth comparing at all: a design with no alternates has nothing to be
 *  compared against, and the compare view would be one cell with a label under it. */
export const comparable = (members: VariantMember[]): boolean => members.length > 1;

/** The member a keyboard digit selects. 1 is A, 2 is B — the letters as they read across the
 *  grid, not as they sit in the set, so the two never disagree. */
export function memberForDigit(members: VariantMember[], digit: number): VariantMember | null {
  return members[digit - 1] ?? null;
}
