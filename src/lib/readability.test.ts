import { expect, test } from "bun:test";
import { newShapeLayer, newTextLayer, type FormatKey, type ThumbDoc } from "../state";
import { contrastRatio, checkReadability, parseHex } from "./readability";

const doc = (layers: ThumbDoc["layers"], format: FormatKey = "youtube", background?: Partial<ThumbDoc["background"]>): ThumbDoc => ({
  format,
  background: { mode: "solid", from: "#000000", to: "#000000", image: null, overlay: 0, ...background },
  layers,
});

/** A text layer that passes every rule, so each test only has to break one thing. */
const clean = () => ({ ...newTextLayer(), name: "Title", text: "Read me", size: 120, color: "#ffffff", stroke: false });

const ids = (doc: ThumbDoc, boxes: Record<string, { x: number; y: number; w: number; h: number }> = {}) =>
  checkReadability(doc, boxes).map((i) => i.id);

test("parseHex handles both shorthand and full form", () => {
  expect(parseHex("#fff")).toEqual([255, 255, 255]);
  expect(parseHex("#0a0B0c")).toEqual([10, 11, 12]);
  expect(parseHex("rebeccapurple")).toBeNull();
});

test("contrastRatio matches the WCAG extremes", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  expect(contrastRatio("#fff", "not a colour")).toBeNull();
});

test("a clean design raises nothing", () => {
  expect(ids(doc([clean()]))).toEqual([]);
});

test("text too small at grid size warns, with the feed size in the message", () => {
  // 210/1280 = 0.164 → a 40px line lands at ~7px in the grid.
  const [issue] = checkReadability(doc([{ ...clean(), size: 40 }]), {});
  expect(issue.id).toMatch(/^size:/);
  expect(issue.severity).toBe("warn");
  expect(issue.message).toContain("7px");
});

test("the same size passes on a format whose grid cell is relatively larger", () => {
  // shorts: 160/1080 = 0.148 — 80px still clears the floor, 40px would not.
  expect(ids(doc([{ ...clean(), size: 80 }], "shorts"))).toEqual([]);
});

test("low contrast against a solid background warns", () => {
  const [issue] = checkReadability(doc([{ ...clean(), color: "#222222" }]), {});
  expect(issue.id).toMatch(/^contrast:/);
});

test("a pill behind the text is what contrast is measured against", () => {
  const dark = { ...clean(), color: "#222222" };
  const pilled = { ...dark, bg: { ...dark.bg, enabled: true, color: "#ffffff" } };
  expect(ids(doc([pilled]))).toEqual([]);
});

test("a thick stroke settles contrast on its own", () => {
  expect(ids(doc([{ ...clean(), color: "#222222", stroke: true, strokeWidth: 6 }]))).toEqual([]);
});

test("a busy background with no scrim is flagged as info, not a warning", () => {
  const [issue] = checkReadability(doc([clean()], "youtube", { mode: "image", image: "data:x", overlay: 0 }), {});
  expect(issue.id).toMatch(/^scrim:/);
  expect(issue.severity).toBe("info");
});

test("a layer under the duration pill warns; the same layer elsewhere doesn't", () => {
  const s = newShapeLayer("rect");
  const under = { [s.id]: { x: 1100, y: 620, w: 150, h: 80 } }; // bottom-right corner
  const clear = { [s.id]: { x: 100, y: 100, w: 150, h: 80 } };
  expect(ids(doc([s]), under)).toContain(`zone:duration:${s.id}`);
  expect(ids(doc([s]), clear)).toEqual([]);
});

test("hidden layers are ignored", () => {
  const s = { ...newShapeLayer("rect"), visible: false };
  expect(ids(doc([s]), { [s.id]: { x: 1100, y: 620, w: 150, h: 80 } })).toEqual([]);
});

test("an Instagram post warns about what the square grid crop cuts", () => {
  const s = newShapeLayer("rect");
  const top = { [s.id]: { x: 100, y: 0, w: 200, h: 200 } }; // above the kept square (y < 135)
  expect(ids(doc([s], "ig-post"), top)).toContain(`zone:grid-crop:${s.id}`);
  expect(ids(doc([s], "ig-post"), { [s.id]: { x: 100, y: 500, w: 200, h: 200 } })).toEqual([]);
});

test("too much copy is one doc-level info, not one per layer", () => {
  const a = { ...clean(), text: "one two three four five" };
  const b = { ...clean(), id: "b", text: "six seven eight nine" };
  const found = checkReadability(doc([a, b]), {}).filter((i) => i.id === "words");
  expect(found).toHaveLength(1);
  expect(found[0].message).toContain("9 words");
});

test("warnings sort ahead of info", () => {
  const small = { ...clean(), size: 40, text: "one two three four five six seven eight nine" };
  const [first, second] = checkReadability(doc([small]), {});
  expect(first.severity).toBe("warn");
  expect(second.severity).toBe("info");
});
