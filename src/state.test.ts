import { expect, test } from "bun:test";
import {
  HISTORY_LIMIT,
  historyReducer,
  initHistory,
  newTextLayer,
  type AppState,
  type ThumbDoc,
} from "./state";

const emptyDoc: ThumbDoc = {
  background: { mode: "solid", from: "#000", to: "#000", image: null, overlay: 0 },
  layers: [],
};
const start = (): AppState => ({ doc: emptyDoc, selectedId: null });

test("paste inserts a fresh clone directly above the selection, offset & selected", () => {
  let h = initHistory(start());
  const a = newTextLayer();
  const b = newTextLayer();
  h = historyReducer(h, { type: "addLayer", layer: a }); // [a]
  h = historyReducer(h, { type: "addLayer", layer: b }); // [a, b], b selected
  h = historyReducer(h, { type: "select", id: a.id }); // select a (bottom)
  h = historyReducer(h, { type: "pasteLayer", layer: a });

  const { layers } = h.present.doc;
  const selectedId = h.present.selectedId;
  expect(layers.map((l) => l.id)).toEqual([a.id, layers[1].id, b.id]); // clone sits above a
  expect(layers[1].id).not.toBe(a.id); // fresh id
  expect(selectedId).toBe(layers[1].id); // clone selected
  expect(layers[1].x).toBe(a.x + 24); // offset applied
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
  h = historyReducer(h, { type: "select", id: a.id });
  const before = h.past.length;
  for (let i = 0; i < 10; i++) h = historyReducer(h, { type: "nudge", id: a.id, dx: 1, dy: 0 });

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
  h = historyReducer(h, { type: "select", id: a.id });
  h = historyReducer(h, { type: "select", id: null });
  expect(h.past.length).toBe(len);
});

test(`history is capped at ${HISTORY_LIMIT} entries`, () => {
  let h = initHistory(start());
  for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = historyReducer(h, { type: "addLayer", layer: newTextLayer() });
  expect(h.past.length).toBe(HISTORY_LIMIT);
});

test("loadDoc resets history (no undo across a project switch)", () => {
  let h = initHistory(start());
  h = historyReducer(h, { type: "addLayer", layer: newTextLayer() });
  h = historyReducer(h, { type: "loadDoc", doc: emptyDoc });
  expect(h.past.length).toBe(0);
  expect(h.future.length).toBe(0);
});
