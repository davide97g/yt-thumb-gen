import { expect, test } from "bun:test";
import { FIT_VIEW, ZOOM_MAX, ZOOM_MIN, clampPan, panBy, wheelPixels, zoomAt, zoomFactor } from "./zoom";

// A 1280×720 canvas fitted at 40% on a stage a little larger than it.
const content = { w: 512, h: 288 };
const stage = { w: 700, h: 400 };

test("zoom stays between fit and the ceiling", () => {
  expect(zoomAt(FIT_VIEW, content, stage, { x: 0, y: 0 }, 0.5).zoom).toBe(ZOOM_MIN);
  expect(zoomAt({ zoom: 6, x: 0, y: 0 }, content, stage, { x: 0, y: 0 }, 4).zoom).toBe(ZOOM_MAX);
});

test("the point under the cursor stays under the cursor", () => {
  // Big enough that the clamp isn't what's holding the offset: at 4× the canvas is 2048 wide
  // on a 700px stage, so there is plenty of slack either side.
  const at = { x: 120, y: -60 };
  const v = zoomAt({ zoom: 2, x: 0, y: 0 }, content, stage, at, 2);
  expect(v.zoom).toBe(4);
  // Canvas coordinate under the cursor, before and after — same point.
  const before = { x: (at.x - 0) / 2, y: (at.y - 0) / 2 };
  const after = { x: (at.x - v.x) / v.zoom, y: (at.y - v.y) / v.zoom };
  expect(after.x).toBeCloseTo(before.x, 10);
  expect(after.y).toBeCloseTo(before.y, 10);
});

test("a canvas smaller than the stage is pinned centred", () => {
  // Nothing is off-screen, so there is nowhere to pan to.
  expect(panBy(FIT_VIEW, content, stage, 200, 200)).toEqual({ zoom: 1, x: 0, y: 0 });
  // …and one axis can overflow while the other doesn't: at 2× the canvas is 1024×576, wider
  // than the stage but only just taller.
  const v = panBy({ zoom: 2, x: 0, y: 0 }, content, stage, 500, 500);
  expect(v.x).toBe((1024 - 700) / 2);
  expect(v.y).toBe((576 - 400) / 2);
});

test("panning never slides an edge past the stage edge", () => {
  const v = clampPan({ zoom: 4, x: 9999, y: -9999 }, content, stage);
  expect(v.x).toBe((content.w * 4 - stage.w) / 2);
  expect(v.y).toBe(-(content.h * 4 - stage.h) / 2);
});

test("zooming in and back out by the same travel returns to where it started", () => {
  const inFactor = zoomFactor(-30);
  const outFactor = zoomFactor(30);
  expect(inFactor).toBeGreaterThan(1);
  expect(inFactor * outFactor).toBeCloseTo(1, 12);
  const at = { x: 40, y: 25 };
  const there = zoomAt({ zoom: 2, x: 0, y: 0 }, content, stage, at, inFactor);
  const back = zoomAt(there, content, stage, at, outFactor);
  expect(back.zoom).toBeCloseTo(2, 10);
  expect(back.x).toBeCloseTo(0, 10);
  expect(back.y).toBeCloseTo(0, 10);
});

test("a line-mode wheel is read as pixels, not as notches", () => {
  expect(wheelPixels(3, 1)).toBe(48);
  expect(wheelPixels(3, 0)).toBe(3);
  expect(wheelPixels(1, 2)).toBe(400);
  // One mouse notch (100px) is a step, not a leap — the clamp is what keeps it civil.
  expect(zoomFactor(wheelPixels(-100, 0))).toBeCloseTo(Math.exp(0.25), 10);
});
