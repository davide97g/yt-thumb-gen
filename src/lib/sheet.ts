/** Layout for a contact sheet — every take of a design in one shareable PNG.
 *
 *  A comparison that only exists inside the editor can't be sent to anyone, and "which of these
 *  three?" is a question you ask in a chat window. So the set composes into a single labelled
 *  image, and this is where it is arranged.
 *
 *  The column count is *chosen*, not fixed: the sheet is picked to land as close to 16:9 as the
 *  cell count allows, because the image will be looked at on a screen and a 1×8 strip of Shorts
 *  is unreadable at any size a chat client will show it. One rule, six formats — the same
 *  reasoning as `planGrid`, scored differently because the box here is an output, not a stage.
 *
 *  Pure, so the arithmetic is checkable without a canvas (see sheet.test.ts). The drawing is
 *  glue and lives in `VariantSheet.tsx`.
 */

/** Roughly how wide the finished sheet should be, before the cell count rounds it. 1600 is
 *  large enough that a YouTube frame in a 3-up sheet is still ~520px — the size a reviewer
 *  actually judges at — and small enough to paste anywhere. */
const TARGET_W = 1600;
/** Largest a single cell may be drawn, so a one-take sheet isn't a 1600px blow-up of a 1280px
 *  design (which would be an upscale, i.e. a worse picture of the same thing). */
const MAX_CELL_W = 1280;
/** …and a ceiling on the other axis too, or one Short in a sheet of its own comes out 2300px
 *  tall — technically correct and useless to look at. */
const MAX_CELL_H = 1080;
/** What a ragged last row costs, as a fraction of the grid left empty, in the same units as the
 *  aspect score. Enough that four wide frames land as 2×2 rather than as a 3-and-1 that happens
 *  to score marginally rounder — and *proportional*, because a flat charge per empty cell made
 *  five tall frames stack into a 3×2 tower to avoid three gaps in a 4×2. */
const RAGGED_PENALTY = 0.4;
/** Never more than four across, whatever the aspect score prefers. Seven Shorts in one row is
 *  195px a frame — a sheet nobody can judge from is not a rounder sheet. */
const MAX_COLS = 4;
const GAP = 24;
const PAD = 32;
/** Room under each cell for "B · name". */
const LABEL_H = 44;
/** Room at the top for the design's name and the date. */
const HEADER_H = 64;
/** The screen shape a sheet is read on. */
const IDEAL_ASPECT = 16 / 9;

export type SheetCell = { x: number; y: number; w: number; h: number };
export type Sheet = {
  width: number;
  height: number;
  cols: number;
  rows: number;
  cell: { w: number; h: number };
  cells: SheetCell[];
  gap: number;
  pad: number;
  labelH: number;
  headerH: number;
};

/** Everything a given column count implies. Cell size follows from `cols`, so both the score and
 *  the finished sheet come from one function and can't disagree. Whole pixels before anything is
 *  placed, so a row of cells tiles rather than accumulating a fractional drift. */
function dims(count: number, cols: number, aspect: number) {
  const rows = Math.ceil(count / cols);
  const w = Math.min(MAX_CELL_W, Math.round(MAX_CELL_H * aspect), Math.floor((TARGET_W - PAD * 2 - GAP * (cols - 1)) / cols));
  const h = Math.round(w / aspect);
  return {
    cols,
    rows,
    w,
    h,
    width: PAD * 2 + cols * w + GAP * (cols - 1),
    height: PAD * 2 + HEADER_H + rows * (h + LABEL_H) + GAP * (rows - 1),
  };
}

/** Arranges `count` frames of `aspect` (w/h) into a sheet. */
export function sheetLayout(count: number, aspect: number): Sheet | null {
  if (count < 1 || !(aspect > 0)) return null;

  // Scored on the sheet it would actually produce, not on a proxy: the header, the padding and
  // the label strips are a large share of a small sheet, and a formula that ignores them picks
  // the wrong arrangement for two or three frames.
  let best = dims(count, 1, aspect);
  let bestScore = Infinity;
  for (let c = 1; c <= Math.min(count, MAX_COLS); c++) {
    const d = dims(count, c, aspect);
    if (d.w <= 0) continue;
    const score =
      Math.abs(Math.log(d.width / d.height / IDEAL_ASPECT)) +
      RAGGED_PENALTY * ((d.cols * d.rows - count) / (d.cols * d.rows));
    if (score < bestScore) { bestScore = score; best = d; }
  }
  const { cols, rows, w, h, width, height } = best;

  const cells: SheetCell[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    cells.push({
      x: PAD + col * (w + GAP),
      y: PAD + HEADER_H + row * (h + LABEL_H + GAP),
      w,
      h,
    });
  }

  return { width, height, cols, rows, cell: { w, h }, cells, gap: GAP, pad: PAD, labelH: LABEL_H, headerH: HEADER_H };
}
