import { expect, test } from "bun:test";
import { MAX_SIDE, SKIP_BYTES, planDownscale } from "./downscale";

const kb = (n: number) => n * 1024;

test("a small, light image is passed through untouched", () => {
  // The case that must stay bit-exact: a brand mark, a logo lockup, a small cut-out.
  expect(planDownscale(512, 512, kb(80))).toEqual({ kind: "keep" });
  expect(planDownscale(MAX_SIDE, 1440, SKIP_BYTES)).toEqual({ kind: "keep" });
});

test("an oversized image is scaled to the cap, keeping its aspect ratio", () => {
  // A 12 MP phone photo, 4:3.
  expect(planDownscale(4032, 3024, 6_000_000)).toEqual({ kind: "encode", w: MAX_SIDE, h: 1920 });
  // Portrait: the cap applies to the longest edge, whichever that is.
  expect(planDownscale(3024, 4032, 6_000_000)).toEqual({ kind: "encode", w: 1920, h: MAX_SIDE });
});

test("an in-cap image that is merely heavy is re-encoded at its own size", () => {
  // A 2000×2000 PNG of a photograph: nothing to shed in pixels, everything to gain in encoding.
  expect(planDownscale(2000, 2000, 12_000_000)).toEqual({ kind: "encode", w: 2000, h: 2000 });
});

test("the cap never rounds an edge away", () => {
  // A panorama: 20000×100 scaled by 2560/20000 is 12.8px, which must not become 0.
  const plan = planDownscale(20000, 100, 9_000_000);
  expect(plan).toEqual({ kind: "encode", w: MAX_SIDE, h: 13 });
});

test("a decoder that reported nothing useful is left alone", () => {
  // Better an oversized image than a canvas sized from NaN.
  for (const [w, h] of [[0, 0], [Number.NaN, 100], [100, Number.POSITIVE_INFINITY]]) {
    expect(planDownscale(w, h, 9_000_000)).toEqual({ kind: "keep" });
  }
});

test("the thresholds are overridable, which is how the policy stays checkable", () => {
  expect(planDownscale(1000, 1000, kb(10), { maxSide: 500 })).toEqual({ kind: "encode", w: 500, h: 500 });
  expect(planDownscale(400, 400, kb(10), { skipBytes: kb(1) })).toEqual({ kind: "encode", w: 400, h: 400 });
});
