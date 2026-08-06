import { expect, test } from "bun:test";
import { boxesIntersect, resolveSnap, alignBoxes, distributeBoxes, type Placed } from "./layout";

test("boxesIntersect: overlapping and disjoint", () => {
  expect(boxesIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  expect(boxesIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 })).toBe(false);
});

test("resolveSnap: snaps box center to a line within threshold", () => {
  // box w=100, raw left=595 → center=645; line 640 is 5 away, snap=6 → snaps.
  const r = resolveSnap({ x: 595, y: 0 }, { w: 100, h: 50 }, [640], [], { vx: null, hy: null }, 6, 12);
  expect(r.vx).toBe(640);
  expect(r.x).toBe(590); // center 640 → left = 640 - 50
});

test("resolveSnap: no snap when outside threshold", () => {
  const r = resolveSnap({ x: 500, y: 0 }, { w: 100, h: 50 }, [640], [], { vx: null, hy: null }, 6, 12);
  expect(r.vx).toBe(null);
  expect(r.x).toBe(500);
});

test("resolveSnap: sticky stays snapped until break distance exceeded", () => {
  // Already snapped to 640. center now at 645 (5 away) < brk 12 → stays.
  const held = resolveSnap({ x: 595, y: 0 }, { w: 100, h: 50 }, [640], [], { vx: 640, hy: null }, 6, 12);
  expect(held.vx).toBe(640);
  // center now at 655 (15 away) > brk 12 → releases.
  const freed = resolveSnap({ x: 605, y: 0 }, { w: 100, h: 50 }, [640], [], { vx: 640, hy: null }, 6, 12);
  expect(freed.vx).toBe(null);
  expect(freed.x).toBe(605);
});

test("alignBoxes: left aligns x to the anchor's left, keeps y", () => {
  const items: Placed[] = [
    { id: "a", box: { x: 30, y: 5, w: 40, h: 20 } }, // anchor — rightmost, and still the one that wins
    { id: "b", box: { x: 10, y: 80, w: 40, h: 20 } },
  ];
  expect(alignBoxes(items, "left")).toEqual([
    { id: "a", x: 30, y: 5 },
    { id: "b", x: 30, y: 80 },
  ]);
});

test("alignBoxes: hcenter centers the rest on the anchor, which never moves", () => {
  const items: Placed[] = [
    { id: "a", box: { x: 0, y: 0, w: 100, h: 10 } }, // anchor, center 50
    { id: "b", box: { x: 40, y: 0, w: 20, h: 10 } },
  ];
  expect(alignBoxes(items, "hcenter")).toEqual([
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 40, y: 0 }, // 50 - 10
  ]);
});

test("alignBoxes: anchor is selection order, not geometry", () => {
  const items: Placed[] = [
    { id: "b", box: { x: 40, y: 0, w: 20, h: 10 } }, // anchor, center 50
    { id: "a", box: { x: 0, y: 0, w: 100, h: 10 } },
  ];
  expect(alignBoxes(items, "hcenter")).toEqual([
    { id: "b", x: 40, y: 0 },
    { id: "a", x: 0, y: 0 }, // 50 - 50
  ]);
  // …and pressing the same button twice changes nothing.
  expect(alignBoxes(items, "right")).toEqual([
    { id: "b", x: 40, y: 0 },
    { id: "a", x: -40, y: 0 }, // anchor right edge 60 - 100
  ]);
});

test("alignBoxes: vcenter/bottom follow the anchor on the y axis only", () => {
  const items: Placed[] = [
    { id: "a", box: { x: 0, y: 100, w: 10, h: 40 } }, // anchor: 100..140, center 120
    { id: "b", box: { x: 70, y: 0, w: 10, h: 20 } },
  ];
  expect(alignBoxes(items, "vcenter")).toEqual([
    { id: "a", x: 0, y: 100 },
    { id: "b", x: 70, y: 110 }, // 120 - 10
  ]);
  expect(alignBoxes(items, "bottom")).toEqual([
    { id: "a", x: 0, y: 100 },
    { id: "b", x: 70, y: 120 }, // 140 - 20
  ]);
});

test("distributeBoxes: even horizontal gaps, ends fixed", () => {
  const items: Placed[] = [
    { id: "a", box: { x: 0, y: 0, w: 10, h: 10 } },
    { id: "c", box: { x: 90, y: 0, w: 10, h: 10 } },
    { id: "b", box: { x: 40, y: 0, w: 10, h: 10 } },
  ]; // sorted by x: a(0..10) b(40..50) c(90..100). span=100, totalW=30, gap=(100-30)/2=35
  expect(distributeBoxes(items, "h")).toEqual([
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 45, y: 0 }, // 10 + 35
    { id: "c", x: 90, y: 0 }, // 45 + 10 + 35
  ]);
});

test("distributeBoxes: fewer than 3 items is a no-op", () => {
  const items: Placed[] = [
    { id: "a", box: { x: 0, y: 0, w: 10, h: 10 } },
    { id: "b", box: { x: 90, y: 0, w: 10, h: 10 } },
  ];
  expect(distributeBoxes(items, "h")).toEqual([
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 90, y: 0 },
  ]);
});
