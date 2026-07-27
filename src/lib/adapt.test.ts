import { expect, test } from "bun:test";
import { newShapeLayer, newTextLayer, type ThumbDoc } from "../state";
import { adaptDocToFormat, adaptDocToFormats } from "./adapt";

const doc = (layers: ThumbDoc["layers"]): ThumbDoc => ({
  format: "youtube",
  background: { mode: "solid", from: "#000", to: "#000", image: null, overlay: 0 },
  layers,
});

test("adapt youtube → shorts contain-scales by width and centers vertically", () => {
  const t = { ...newTextLayer(), x: 0, y: 0, size: 100 };
  const out = adaptDocToFormat(doc([t]), "shorts"); // f = min(1080/1280, 1920/720) = 0.84375
  const f = 1080 / 1280;
  const l = out.layers[0] as typeof t;
  expect(out.format).toBe("shorts");
  expect(l.x).toBe(0); // width-fit → no horizontal offset
  expect(l.y).toBe((1920 - 720 * f) / 2); // scaled 16:9 band centered vertically
  expect(l.size).toBe(Math.round(100 * f));
});

test("adapt scales shape w/h and keeps rotation", () => {
  const s = { ...newShapeLayer("rect"), x: 100, y: 100, w: 400, h: 200, rotation: 30 };
  const out = adaptDocToFormat(doc([s]), "ig-post"); // f = min(1080/1280, 1350/720) = 0.84375
  const f = 1080 / 1280;
  const l = out.layers[0] as typeof s;
  expect(l.w).toBeCloseTo(400 * f);
  expect(l.h).toBeCloseTo(200 * f);
  expect(l.rotation).toBe(30);
});

test("adapt to the same format is the identity", () => {
  const t = { ...newTextLayer(), x: 123, y: 45, size: 96 };
  const out = adaptDocToFormat(doc([t]), "youtube");
  const l = out.layers[0] as typeof t;
  expect(l.x).toBe(123);
  expect(l.y).toBe(45);
  expect(l.size).toBe(96);
});

test("a campaign set yields one entry per distinct format, in order", () => {
  const set = adaptDocToFormats(doc([newTextLayer()]), ["ig-reel", "youtube", "ig-reel", "linkedin"]);
  expect(set.map((s) => s.format)).toEqual(["ig-reel", "youtube", "linkedin"]);
  for (const s of set) expect(s.doc.format).toBe(s.format);
});

test("campaign variants are independent documents", () => {
  const source = doc([newTextLayer()]);
  const [a, b] = adaptDocToFormats(source, ["youtube", "shorts"]);

  // Editing one variant must not reach the others or the master — each is saved as its
  // own project and diverges from there. Nested values count: adaptDocToFormat only
  // shallow-copies layers, so `bg` would alias without an explicit clone.
  const A = a.doc.layers[0] as ReturnType<typeof newTextLayer>;
  A.text = "cambiato";
  A.bg.color = "#123456";
  a.doc.background.from = "#00ff00";

  const B = b.doc.layers[0] as ReturnType<typeof newTextLayer>;
  expect(B.text).not.toBe("cambiato");
  expect(B.bg.color).not.toBe("#123456");
  expect(b.doc.background.from).not.toBe("#00ff00");

  const M = source.layers[0] as ReturnType<typeof newTextLayer>;
  expect(M.text).not.toBe("cambiato");
  expect(M.bg.color).not.toBe("#123456");
  expect(source.background.from).not.toBe("#00ff00");
});
