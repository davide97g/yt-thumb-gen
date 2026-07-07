import { expect, test } from "bun:test";
import {
  HISTORY_LIMIT,
  historyReducer,
  initHistory,
  newTextLayer,
  primaryId,
  type AppState,
  type ThumbDoc,
} from "./state";

const emptyDoc: ThumbDoc = {
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

test("selection changes never create history", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a });
  const len = h.past.length;
  h = historyReducer(h, { type: "select", ids: [a.id] });
  h = historyReducer(h, { type: "select", ids: [] });
  expect(h.past.length).toBe(len);
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
