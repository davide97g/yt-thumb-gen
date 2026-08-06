import { expect, test } from "bun:test";
import {
  HISTORY_LIMIT,
  historyReducer,
  initHistory,
  migrateDoc,
  newTextLayer,
  primaryId,
  type AppState,
  type ThumbDoc,
} from "./state";
import {
  newEmojiFxLayer,
  layoutEmojiFx,
} from "./state";

const emptyDoc: ThumbDoc = {
  format: "youtube",
  background: { mode: "solid", from: "#000", to: "#000", image: null, overlay: 0 },
  layers: [],
};
const start = (): AppState => ({ doc: emptyDoc, selectedIds: [] });

test("paste inserts a fresh clone directly above the selection, offset & selected", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  const b = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a }); // [a]
  h = historyReducer(h, { type: "addLayer", layer: b }); // [a, b], b selected
  h = historyReducer(h, { type: "select", ids: [a.id] }); // select a (bottom)
  h = historyReducer(h, { type: "pasteLayer", layer: a });

  const { layers } = h.present.doc;
  const selectedId = primaryId(h.present);
  expect(layers.map((l) => l.id)).toEqual([a.id, layers[1].id, b.id]); // clone sits above a
  expect(layers[1].id).not.toBe(a.id); // fresh id
  expect(selectedId).toBe(layers[1].id); // clone selected
  expect(layers[1].x).toBe(a.x + 24); // offset applied
});

test("pasting a clone of a grouped layer does NOT inherit groupId (copy/paste stays single-layer)", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  const b = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a });
  h = historyReducer(h, { type: "addLayer", layer: b });
  h = historyReducer(h, { type: "group", ids: [a.id, b.id] });

  const grouped = h.present.doc.layers.find((l) => l.id === a.id)!;
  expect(grouped.groupId).toBeTruthy(); // sanity: a is really grouped before pasting

  const beforeIds = new Set(h.present.doc.layers.map((l) => l.id));
  h = historyReducer(h, { type: "select", ids: [a.id] });
  h = historyReducer(h, { type: "pasteLayer", layer: grouped });

  const clone = h.present.doc.layers.find((l) => !beforeIds.has(l.id))!;
  expect(clone).toBeTruthy(); // fresh layer was actually inserted
  expect(primaryId(h.present)).toBe(clone.id); // clone is the one selected
  expect("groupId" in clone).toBe(false); // must NOT just be undefined — key itself must be absent
});

test("undo / redo step through discrete edits", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a });
  expect(h.present.doc.layers.length).toBe(1);

  h = historyReducer(h, { type: "undo" });
  expect(h.present.doc.layers.length).toBe(0);

  h = historyReducer(h, { type: "redo" });
  expect(h.present.doc.layers.length).toBe(1);
});

test("a continuous gesture (drag = many nudges) collapses to ONE undo entry", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a }); // entry 1
  h = historyReducer(h, { type: "select", ids: [a.id] });
  const before = h.past.length;
  for (let i = 0; i < 10; i++) h = historyReducer(h, { type: "nudge", ids: [a.id], dx: 1, dy: 0 });

  expect(h.past.length).toBe(before + 1); // 10 nudges → 1 entry
  const moved = h.present.doc.layers[0].x;
  h = historyReducer(h, { type: "undo" });
  expect(h.present.doc.layers[0].x).toBe(moved - 10); // whole drag reverted at once
});

test("arrow-key bursts: same gesture coalesces, a new one is its own entry", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a });
  h = historyReducer(h, { type: "select", ids: [a.id] });
  const before = h.past.length;

  // One burst of taps — no `select` between them, so only the gesture id separates bursts.
  for (let i = 0; i < 5; i++) h = historyReducer(h, { type: "nudge", ids: [a.id], dx: 1, dy: 0, gesture: "arrow1" });
  expect(h.past.length).toBe(before + 1);

  // A tap after the idle gap carries the next id and starts a second entry.
  h = historyReducer(h, { type: "nudge", ids: [a.id], dx: 10, dy: 0, gesture: "arrow2" });
  expect(h.past.length).toBe(before + 2);

  const x = h.present.doc.layers[0].x;
  h = historyReducer(h, { type: "undo" });
  expect(h.present.doc.layers[0].x).toBe(x - 10); // only the second burst came back
});

test("selection changes never create history", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a });
  const len = h.past.length;
  h = historyReducer(h, { type: "select", ids: [a.id] });
  h = historyReducer(h, { type: "select", ids: [] });
  expect(h.past.length).toBe(len);
});

// ── moveLayers (drag-reorder in the layer list) ──────────────────────────────
// `toIndex` is a gap in the *current* array: 0 = behind everything, length = in front.

const stackOf = (n: number) => {
  let h = initHistory(start());
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const l = newTextLayer();
    ids.push(l.id);
    h = historyReducer(h, { type: "addLayer", layer: l });
  }
  return { h, ids };
};
const order = (h: ReturnType<typeof initHistory>, ids: string[]) =>
  h.present.doc.layers.map((l) => ids.indexOf(l.id));

test("moveLayers drops a single layer at the requested gap", () => {
  const { h: h0, ids } = stackOf(4); // [0,1,2,3]
  let h = historyReducer(h0, { type: "moveLayers", ids: [ids[0]], toIndex: 3 });
  expect(order(h, ids)).toEqual([1, 2, 0, 3]); // gap 3 sits between 2 and 3

  h = historyReducer(h0, { type: "moveLayers", ids: [ids[3]], toIndex: 0 });
  expect(order(h, ids)).toEqual([3, 0, 1, 2]); // all the way to the back

  h = historyReducer(h0, { type: "moveLayers", ids: [ids[1]], toIndex: 4 });
  expect(order(h, ids)).toEqual([0, 2, 3, 1]); // all the way to the front
});

test("moveLayers moves a multi-selection as a block, keeping its relative order", () => {
  const { h: h0, ids } = stackOf(5); // [0,1,2,3,4]
  // Non-contiguous selection, passed in reverse — the block keeps *doc* order, not id order.
  let h = historyReducer(h0, { type: "moveLayers", ids: [ids[3], ids[0]], toIndex: 5 });
  expect(order(h, ids)).toEqual([1, 2, 4, 0, 3]);

  h = historyReducer(h0, { type: "moveLayers", ids: [ids[1], ids[2]], toIndex: 0 });
  expect(order(h, ids)).toEqual([1, 2, 0, 3, 4]);

  // A gap *after* some of the moved layers is rebased onto the lifted array, so the
  // block lands where the drop indicator was — not shifted by its own removal.
  h = historyReducer(h0, { type: "moveLayers", ids: [ids[0], ids[1]], toIndex: 4 });
  expect(order(h, ids)).toEqual([2, 3, 0, 1, 4]);
});

test("dropping a selection back where it already was costs no history entry", () => {
  const { h: h0, ids } = stackOf(3);
  const before = h0.past.length;
  const h = historyReducer(h0, { type: "moveLayers", ids: [ids[0], ids[1]], toIndex: 0 });
  expect(order(h, ids)).toEqual([0, 1, 2]);
  expect(h.past.length).toBe(before); // no-op → historyReducer drops it
});

test("a whole drag-reorder is one undo entry", () => {
  const { h: h0, ids } = stackOf(3);
  let h = historyReducer(h0, { type: "moveLayers", ids: [ids[2]], toIndex: 0 });
  expect(order(h, ids)).toEqual([2, 0, 1]);
  h = historyReducer(h, { type: "undo" });
  expect(order(h, ids)).toEqual([0, 1, 2]);
});

test(`history is capped at ${HISTORY_LIMIT} entries`, () => {
  let h = initHistory(start());
  for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = historyReducer(h, { type: "addLayer", layer: newTextLayer() });
  expect(h.past.length).toBe(HISTORY_LIMIT);
});

test("re-selecting an already-selected layer still resets the gesture tag, so a following drag starts a new history entry", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a }); // entry 1
  h = historyReducer(h, { type: "select", ids: [a.id] });
  h = historyReducer(h, { type: "nudge", ids: [a.id], dx: 1, dy: 0 }); // drag 1 → entry 2
  const afterDrag1 = h.past.length;

  // Same layer is already selected, but startDrag re-dispatches select unconditionally
  // (the fix under test) so the tag resets between drags of the same layer.
  h = historyReducer(h, { type: "select", ids: [a.id] });
  h = historyReducer(h, { type: "nudge", ids: [a.id], dx: 1, dy: 0 }); // drag 2 → should be a NEW entry

  expect(h.past.length).toBe(afterDrag1 + 1); // drag 2 did not coalesce into drag 1
});

test("loadDoc resets history (no undo across a project switch)", () => {
  let h = initHistory(start());
  h = historyReducer(h, { type: "addLayer", layer: newTextLayer() });
  h = historyReducer(h, { type: "loadDoc", doc: emptyDoc });
  expect(h.past.length).toBe(0);
  expect(h.future.length).toBe(0);
});

test("group assigns a shared groupId to the given ids without reordering the layers array", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  const b = newTextLayer();
  const c = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a });
  h = historyReducer(h, { type: "addLayer", layer: b });
  h = historyReducer(h, { type: "addLayer", layer: c });
  const orderBefore = h.present.doc.layers.map((l) => l.id);

  h = historyReducer(h, { type: "group", ids: [a.id, c.id] });

  const { layers } = h.present.doc;
  expect(layers.map((l) => l.id)).toEqual(orderBefore); // no reordering
  const ga = layers.find((l) => l.id === a.id)!.groupId;
  const gc = layers.find((l) => l.id === c.id)!.groupId;
  expect(ga).toBeTruthy();
  expect(ga).toBe(gc); // shared groupId
  expect(layers.find((l) => l.id === b.id)!.groupId).toBeUndefined(); // untouched
});

test("ungroup removes the groupId key from the given layers", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  const b = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a });
  h = historyReducer(h, { type: "addLayer", layer: b });
  h = historyReducer(h, { type: "group", ids: [a.id, b.id] });
  expect(h.present.doc.layers.find((l) => l.id === a.id)!.groupId).toBeTruthy();

  h = historyReducer(h, { type: "ungroup", ids: [a.id, b.id] });

  const { layers } = h.present.doc;
  expect("groupId" in layers.find((l) => l.id === a.id)!).toBe(false);
  expect("groupId" in layers.find((l) => l.id === b.id)!).toBe(false);
});

test("removeLayers removes all given ids and drops them from selectedIds", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  const b = newTextLayer();
  const c = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a });
  h = historyReducer(h, { type: "addLayer", layer: b });
  h = historyReducer(h, { type: "addLayer", layer: c });
  h = historyReducer(h, { type: "select", ids: [a.id, b.id, c.id] });

  h = historyReducer(h, { type: "removeLayers", ids: [a.id, c.id] });

  expect(h.present.doc.layers.map((l) => l.id)).toEqual([b.id]);
  expect(h.present.selectedIds).toEqual([b.id]);
});

test("setPositions sets absolute x/y for the given ids, leaving others untouched", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  const b = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a });
  h = historyReducer(h, { type: "addLayer", layer: b });
  const bBefore = h.present.doc.layers.find((l) => l.id === b.id)!;

  h = historyReducer(h, { type: "setPositions", positions: [{ id: a.id, x: 111, y: 222 }] });

  const aAfter = h.present.doc.layers.find((l) => l.id === a.id)!;
  const bAfter = h.present.doc.layers.find((l) => l.id === b.id)!;
  expect(aAfter.x).toBe(111);
  expect(aAfter.y).toBe(222);
  expect(bAfter.x).toBe(bBefore.x); // untouched
  expect(bAfter.y).toBe(bBefore.y);
});

const CENTER = { cx: 640, cy: 360 };

test("layoutEmojiFx returns exactly `count` placements", () => {
  const l = { ...newEmojiFxLayer(), count: 24 };
  expect(layoutEmojiFx(l, CENTER).length).toBe(24);
});

test("layoutEmojiFx is deterministic for a fixed seed", () => {
  const l = { ...newEmojiFxLayer(), seed: 12345 };
  expect(layoutEmojiFx(l, CENTER)).toEqual(layoutEmojiFx(l, CENTER));
});

test("layoutEmojiFx reseeds a different arrangement for a different seed", () => {
  const a = layoutEmojiFx({ ...newEmojiFxLayer(), seed: 1 }, CENTER);
  const b = layoutEmojiFx({ ...newEmojiFxLayer(), seed: 2 }, CENTER);
  expect(a).not.toEqual(b);
});

test("ring pattern straddles the image (has both front and behind emojis)", () => {
  const l = { ...newEmojiFxLayer(), pattern: "ring" as const, count: 24 };
  const placed = layoutEmojiFx(l, CENTER);
  expect(placed.some((p) => p.front)).toBe(true);
  expect(placed.some((p) => !p.front)).toBe(true);
});

test("ring placements stay within radius (x) and radius*tilt (y) of center, plus jitter", () => {
  const l = { ...newEmojiFxLayer(), pattern: "ring" as const, radius: 300, tilt: 0.5, count: 40, sizeJitter: 0 };
  for (const p of layoutEmojiFx(l, CENTER)) {
    expect(Math.abs(p.x - CENTER.cx)).toBeLessThanOrEqual(300 + 1);
    expect(Math.abs(p.y - CENTER.cy)).toBeLessThanOrEqual(300 * 0.5 + 1);
  }
});

test("empty glyphs falls back to a default so placements are never blank", () => {
  const l = { ...newEmojiFxLayer(), glyphs: [] as string[], count: 4 };
  expect(layoutEmojiFx(l, CENTER).every((p) => p.glyph.length > 0)).toBe(true);
});

// ── setFormat ───────────────────────────────────────────────────────────────

test("setFormat translates all layers by the canvas-center delta and is one undo entry", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a });
  const before = h.present.doc.layers[0];

  h = historyReducer(h, { type: "setFormat", format: "shorts" }); // 1280×720 → 1080×1920
  const after = h.present.doc.layers[0];
  expect(h.present.doc.format).toBe("shorts");
  expect(after.x).toBe(before.x + (1080 - 1280) / 2);
  expect(after.y).toBe(before.y + (1920 - 720) / 2);

  h = historyReducer(h, { type: "undo" }); // single undo restores format AND positions
  expect(h.present.doc.format).toBe("youtube");
  expect(h.present.doc.layers[0].x).toBe(before.x);
  expect(h.present.doc.layers[0].y).toBe(before.y);
});

test("setFormat to the same format is a no-op that adds no history entry", () => {
  let h = initHistory(start());
  h = historyReducer(h, { type: "setFormat", format: "youtube" });
  expect(h.past.length).toBe(0);
});

test("migrateDoc backfills format on pre-feature docs", () => {
  const legacy = { background: emptyDoc.background, layers: [] } as unknown as ThumbDoc;
  expect(migrateDoc(legacy).format).toBe("youtube");
});
