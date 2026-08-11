import { expect, test } from "bun:test";
import { sheetLayout } from "./sheet";

const YT = 16 / 9;
const SHORTS = 1080 / 1920;

test("one take is one cell, and never upscaled past the design's own width", () => {
  const s = sheetLayout(1, YT)!;
  expect(s).toMatchObject({ cols: 1, rows: 1 });
  expect(s.cell.w).toBeLessThanOrEqual(1280);
  expect(s.cell.w / s.cell.h).toBeCloseTo(YT, 2);
});

// The reason the column count is scored rather than hardcoded: four wide frames want 2×2, four
// tall ones want a row, and one constant gets one of them wrong.
test("the arrangement follows the frame's shape", () => {
  // Two wide frames read side by side; four fold into a square rather than a 3-and-1, which is
  // what the ragged-row penalty is for.
  expect(sheetLayout(2, YT)!).toMatchObject({ cols: 2, rows: 1 });
  expect(sheetLayout(4, YT)!).toMatchObject({ cols: 2, rows: 2 });
  // Tall frames go across, because stacking them is what makes an unviewable sheet.
  expect(sheetLayout(2, SHORTS)!).toMatchObject({ cols: 2, rows: 1 });
  expect(sheetLayout(4, SHORTS)!).toMatchObject({ cols: 4, rows: 1 });
});

test("never more than four across, whatever the aspect score prefers", () => {
  for (let n = 5; n <= 9; n++) {
    expect(sheetLayout(n, SHORTS)!.cols).toBeLessThanOrEqual(4);
    expect(sheetLayout(n, YT)!.cols).toBeLessThanOrEqual(4);
  }
});

test("a sheet of more than one take lands near the shape it will be looked at in", () => {
  for (const aspect of [YT, SHORTS, 1, 4 / 5]) {
    // n = 1 is excluded on purpose: a single tall frame cannot be 16:9, and cropping or padding
    // it to look like one would be a worse picture of the design.
    for (let n = 2; n <= 9; n++) {
      const ratio = sheetLayout(n, aspect)!.width / sheetLayout(n, aspect)!.height;
      // Within a factor of ~2.5 either way. A strip seven frames long is what this rules out,
      // not every departure from the ideal: nine Shorts is a tall sheet however it is folded.
      expect(ratio).toBeGreaterThan(16 / 9 / 2.6);
      expect(ratio).toBeLessThan((16 / 9) * 2.6);
    }
  }
});

test("cells tile exactly inside the sheet, with room for the header and the labels", () => {
  for (let n = 1; n <= 8; n++) {
    const s = sheetLayout(n, YT)!;
    expect(s.cells).toHaveLength(n);
    for (const c of s.cells) {
      expect(c.x).toBeGreaterThanOrEqual(s.pad);
      expect(c.y).toBeGreaterThanOrEqual(s.pad + s.headerH);
      expect(c.x + c.w).toBeLessThanOrEqual(s.width - s.pad);
      // The label strip under the last row has to fit too.
      expect(c.y + c.h + s.labelH).toBeLessThanOrEqual(s.height - s.pad);
    }
    // Whole pixels, so a row of cells tiles rather than drifting.
    expect(s.cell.w).toBe(Math.round(s.cell.w));
    expect(s.cell.h).toBe(Math.round(s.cell.h));
  }
});

test("nonsense in, nothing out", () => {
  expect(sheetLayout(0, YT)).toBeNull();
  expect(sheetLayout(2, 0)).toBeNull();
  expect(sheetLayout(2, NaN)).toBeNull();
});
