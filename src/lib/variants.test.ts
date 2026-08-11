import { expect, test } from "bun:test";
import { CELL_GAP, CELL_LABEL_H, LIVE_CELLS, comparable, labelOf, memberForDigit, planGrid, visible } from "./variants";
import type { VariantMember } from "./storage";

const YT = { w: 1280, h: 720 };
const SHORTS = { w: 1080, h: 1920 };
const stage = { w: 900, h: 600 };

const member = (id: string, over: Partial<VariantMember> = {}): VariantMember => ({
  id,
  name: id,
  label: id === "a" ? null : id.toUpperCase(),
  isBase: id === "a",
  format: "youtube",
  preview: null,
  note: null,
  wonAt: null,
  updatedAt: 0,
  ...over,
});

test("one design fills the stage; the plan is the same shape as the canvas", () => {
  const plan = planGrid(1, stage, YT)!;
  expect(plan).toMatchObject({ cols: 1, rows: 1 });
  expect(plan.cell.w / plan.cell.h).toBeCloseTo(16 / 9, 10);
  // Height binds here: 900 wide would need 506 of height, and the stage has 600 minus the label.
  expect(plan.cell.w).toBeCloseTo(Math.min(900, (600 - CELL_LABEL_H) * (16 / 9)), 6);
  expect(plan.scale).toBeCloseTo(plan.cell.w / 1280, 12);
});

// The reason the column count is searched rather than fixed: the best layout for two 16:9s is
// not the best layout for two 9:16s, and a hardcoded 2×1 gets one of them badly wrong.
test("the column count follows the aspect ratio, not a constant", () => {
  expect(planGrid(2, stage, YT)!).toMatchObject({ cols: 1, rows: 2 });
  expect(planGrid(2, stage, SHORTS)!).toMatchObject({ cols: 2, rows: 1 });
});

test("nothing overflows the box it was given", () => {
  for (const canvas of [YT, SHORTS]) {
    for (let n = 1; n <= LIVE_CELLS; n++) {
      const p = planGrid(n, stage, canvas)!;
      expect(p.cols * p.rows).toBeGreaterThanOrEqual(n);
      expect(p.cols * p.cell.w + CELL_GAP * (p.cols - 1)).toBeLessThanOrEqual(stage.w + 0.001);
      expect(p.rows * (p.cell.h + CELL_LABEL_H) + CELL_GAP * (p.rows - 1)).toBeLessThanOrEqual(stage.h + 0.001);
    }
  }
});

test("a cell too small to judge is no plan at all", () => {
  // Four 16:9 frames in a 200×120 box would be ~95px wide — a thumbnail, not a comparison.
  expect(planGrid(4, { w: 200, h: 120 }, YT)).toBeNull();
  expect(planGrid(0, stage, YT)).toBeNull();
  expect(planGrid(2, { w: 0, h: 0 }, YT)).toBeNull();
  // …and the floor is the caller's to set, so a deliberately dense grid is still expressible.
  expect(planGrid(4, { w: 200, h: 120 }, YT, 40)).not.toBeNull();
});

test("under the ceiling every design is shown", () => {
  const members = [member("a"), member("b")];
  expect(visible(members, "b")).toEqual({ shown: members, hidden: [] });
});

// The two halves of the cap: the design being edited can never be the one dropped, and what is
// dropped is *reported* — a comparison missing two candidates has to say so.
test("over the ceiling the active design survives and the rest are named", () => {
  const members = ["a", "b", "c", "d", "e", "f"].map((id) => member(id));
  const { shown, hidden } = visible(members, "f", 3);
  expect(shown.map((m) => m.id)).toContain("f");
  expect(shown).toHaveLength(3);
  expect(hidden).toHaveLength(3);
  // Set order is preserved in both, or the letters wouldn't read A B C across the grid.
  expect(shown.map((m) => m.id)).toEqual(["a", "b", "f"]);
  expect(hidden.map((m) => m.id)).toEqual(["c", "d", "e"]);
});

test("the base is A without carrying a label", () => {
  expect(labelOf(member("a"))).toBe("A");
  expect(labelOf(member("b"))).toBe("B");
  expect(labelOf({ isBase: false, label: null })).toBe("?");
});

test("a design with no alternates isn't a comparison", () => {
  expect(comparable([member("a")])).toBe(false);
  expect(comparable([member("a"), member("b")])).toBe(true);
});

test("a digit picks the member whose letter it is", () => {
  const members = [member("a"), member("b")];
  expect(memberForDigit(members, 1)?.id).toBe("a");
  expect(memberForDigit(members, 2)?.id).toBe("b");
  expect(memberForDigit(members, 3)).toBeNull();
});
