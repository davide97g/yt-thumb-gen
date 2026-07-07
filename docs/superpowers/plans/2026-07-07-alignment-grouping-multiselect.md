# Alignment guides, grouping, and multi-selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sticky alignment guides while dragging, layer grouping (⌘G/⌘⇧G), and multi-selection (shift-click, marquee, align/distribute) to the thumbnail editor.

**Architecture:** A pure geometry module (`src/lib/layout.ts`) holds all snapping and align/distribute math, unit-tested with `bun test`. The document state moves from a single `selectedId` to a `selectedIds: string[]` array, and layers gain an optional `groupId`. `ThumbCanvas` reads each layer's rendered box straight from the DOM (layer boxes are in canvas-unit space because the canvas is scaled by a CSS `transform`, not layout), so no sizes need to enter the doc.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, `bun test` (via `bun:test`), lucide-react icons.

## Global Constraints

- `bun run check` (`tsc --noEmit`) must pass at the end of every task — it is the only build gate.
- `bun test` must pass for tasks that touch `src/lib/layout.ts` or `src/state.ts`.
- User-facing strings are **Italian** — match existing copy.
- Coordinates are always in 1280×720 space (`CANVAS_W`/`CANVAS_H`), never screen pixels.
- Use the `newXxxLayer()` factories; never hand-build layer objects.
- Mark deliberate simplifications with `// ponytail:` comments.
- Grouping is logical-only: `groupId` never reorders the layer array. No nested groups.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/layout.ts` | **New.** Pure geometry: `Box`, `boxesIntersect`, `resolveSnap` (sticky snapping), `alignBoxes`, `distributeBoxes`. No React, no DOM. |
| `src/lib/layout.test.ts` | **New.** `bun:test` unit tests for `layout.ts`. |
| `src/state.ts` | Model + reducer. `selectedIds`, `groupId`, new actions, gesture coalescing. |
| `src/state.test.ts` | Update existing tests to `selectedIds`; add coverage for new actions. |
| `src/App.tsx` | Wire `selectedIds`, derive primary, add ⌘G/⌘⇧G/multi-delete shortcuts, pass new props. |
| `src/components/ThumbCanvas.tsx` | Drag-set + snapping + guides + marquee + group-aware click/dbl-click + multi selection outline. |
| `src/components/Inspector.tsx` | "Allinea" section (align/distribute/group/ungroup) when ≥2 selected. |
| `src/components/LayerList.tsx` | Multi-highlight, shift-click toggle, group-aware select, group badge. |

---

## Task 1: Pure geometry module (`src/lib/layout.ts`)

**Files:**
- Create: `src/lib/layout.ts`
- Test: `src/lib/layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Box = { x: number; y: number; w: number; h: number }`
  - `type Placed = { id: string; box: Box }`
  - `type SnapResult = { x: number; y: number; vx: number | null; hy: number | null }`
  - `type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"`
  - `boxesIntersect(a: Box, b: Box): boolean`
  - `resolveSnap(raw: {x:number;y:number}, size: {w:number;h:number}, xLines: number[], yLines: number[], sticky: {vx:number|null;hy:number|null}, snap: number, brk: number): SnapResult`
  - `alignBoxes(items: Placed[], edge: AlignEdge): { id: string; x: number; y: number }[]`
  - `distributeBoxes(items: Placed[], axis: "h" | "v"): { id: string; x: number; y: number }[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/layout.test.ts`:

```ts
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

test("alignBoxes: left aligns x to min left, keeps y", () => {
  const items: Placed[] = [
    { id: "a", box: { x: 10, y: 5, w: 40, h: 20 } },
    { id: "b", box: { x: 30, y: 80, w: 40, h: 20 } },
  ];
  expect(alignBoxes(items, "left")).toEqual([
    { id: "a", x: 10, y: 5 },
    { id: "b", x: 10, y: 80 },
  ]);
});

test("alignBoxes: hcenter centers each box on the selection bbox center", () => {
  const items: Placed[] = [
    { id: "a", box: { x: 0, y: 0, w: 100, h: 10 } }, // right edge 100
    { id: "b", box: { x: 40, y: 0, w: 20, h: 10 } }, // right edge 60
  ]; // bbox 0..100, center 50
  expect(alignBoxes(items, "hcenter")).toEqual([
    { id: "a", x: 0, y: 0 }, // 50 - 50
    { id: "b", x: 40, y: 0 }, // 50 - 10
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/layout.test.ts`
Expected: FAIL — `Cannot find module './layout'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/layout.ts`:

```ts
// Pure geometry for the editor: sticky drag-snapping and align/distribute.
// No React, no DOM — all inputs are plain numbers in 1280×720 canvas units,
// so this is unit-testable in isolation (see layout.test.ts).

export type Box = { x: number; y: number; w: number; h: number };
export type Placed = { id: string; box: Box };
export type SnapResult = { x: number; y: number; vx: number | null; hy: number | null };
export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Axis-aligned overlap test (used by marquee selection). */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** One axis of snapping. `left` is the box's start on this axis, `extent` its
 *  size; the three moving points are start / centre / end. `stickyLine` is the
 *  line we were snapped to last frame (or null). Returns the adjusted start and
 *  the active line (null = free). Hysteresis: once snapped, stay until a moving
 *  point drifts more than `brk` from the line; otherwise snap when within `snap`. */
function snapAxis(
  left: number, extent: number, lines: number[], stickyLine: number | null, snap: number, brk: number,
): { pos: number; line: number | null } {
  const pts = [left, left + extent / 2, left + extent];
  if (stickyLine != null) {
    let best = Infinity, bp = left;
    for (const p of pts) { const d = Math.abs(p - stickyLine); if (d < best) { best = d; bp = p; } }
    if (best <= brk) return { pos: left + (stickyLine - bp), line: stickyLine };
  }
  let best = Infinity, bp = left, bl: number | null = null;
  for (const p of pts) for (const L of lines) { const d = Math.abs(p - L); if (d < best) { best = d; bp = p; bl = L; } }
  if (bl != null && best <= snap) return { pos: left + (bl - bp), line: bl };
  return { pos: left, line: null };
}

/** Snap a dragged box's raw top-left to the nearest candidate lines on each axis. */
export function resolveSnap(
  raw: { x: number; y: number }, size: { w: number; h: number },
  xLines: number[], yLines: number[], sticky: { vx: number | null; hy: number | null },
  snap: number, brk: number,
): SnapResult {
  const ax = snapAxis(raw.x, size.w, xLines, sticky.vx, snap, brk);
  const ay = snapAxis(raw.y, size.h, yLines, sticky.hy, snap, brk);
  return { x: ax.pos, y: ay.pos, vx: ax.line, hy: ay.line };
}

/** New x/y for each box so the selection aligns on the given edge/centre.
 *  Only the relevant axis changes; the other coordinate is preserved. */
export function alignBoxes(items: Placed[], edge: AlignEdge): { id: string; x: number; y: number }[] {
  if (items.length === 0) return [];
  const minX = Math.min(...items.map((i) => i.box.x));
  const maxR = Math.max(...items.map((i) => i.box.x + i.box.w));
  const minY = Math.min(...items.map((i) => i.box.y));
  const maxB = Math.max(...items.map((i) => i.box.y + i.box.h));
  const cx = (minX + maxR) / 2, cy = (minY + maxB) / 2;
  return items.map(({ id, box }) => {
    let { x, y } = box;
    if (edge === "left") x = minX;
    else if (edge === "right") x = maxR - box.w;
    else if (edge === "hcenter") x = cx - box.w / 2;
    else if (edge === "top") y = minY;
    else if (edge === "bottom") y = maxB - box.h;
    else if (edge === "vcenter") y = cy - box.h / 2;
    return { id, x, y };
  });
}

/** Even out the gaps between boxes along one axis, holding the two extremes
 *  fixed. No-op for fewer than 3 items. */
export function distributeBoxes(items: Placed[], axis: "h" | "v"): { id: string; x: number; y: number }[] {
  if (items.length < 3) return items.map(({ id, box }) => ({ id, x: box.x, y: box.y }));
  const get = (b: Box) => (axis === "h" ? b.x : b.y);
  const ext = (b: Box) => (axis === "h" ? b.w : b.h);
  const sorted = [...items].sort((a, b) => get(a.box) - get(b.box));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = get(last.box) + ext(last.box) - get(first.box);
  const totalExt = sorted.reduce((sum, i) => sum + ext(i.box), 0);
  const gap = (span - totalExt) / (sorted.length - 1);
  let cursor = get(first.box);
  return sorted.map(({ id, box }) => {
    const v = cursor;
    cursor += ext(box) + gap;
    return axis === "h" ? { id, x: v, y: box.y } : { id, x: box.x, y: v };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/layout.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the type check**

Run: `bun run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/layout.ts src/lib/layout.test.ts
git commit -m "feat(layout): pure snapping + align/distribute geometry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: State model migration (`src/state.ts` + all consumers)

Moves `selectedId → selectedIds`, adds `groupId` and the new actions, and updates every consumer just enough to compile and behave **exactly as today** (single-select). No new UI behavior yet.

**Files:**
- Modify: `src/state.ts`
- Modify: `src/state.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/ThumbCanvas.tsx`
- Modify: `src/components/LayerList.tsx`
- Modify: `src/components/Inspector.tsx` (only if it reads `selectedId` — it does not today; touch only if `bun run check` flags it)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `type AppState = { doc: ThumbDoc; selectedIds: string[] }`
  - `LayerBase.groupId?: string`
  - `primaryId(s: AppState): string | null`
  - Actions: `{ type: "select"; ids: string[] }`, `{ type: "nudge"; ids: string[]; dx: number; dy: number }`, `{ type: "setPositions"; positions: { id: string; x: number; y: number }[] }`, `{ type: "group"; ids: string[] }`, `{ type: "ungroup"; ids: string[] }`, `{ type: "removeLayers"; ids: string[] }`
  - Kept: `removeLayer { id }`, `reorder`, `updateLayer`, `pasteLayer`, `addLayer`, `updateBackground`, `loadDoc`.

- [ ] **Step 1: Update `LayerBase` with `groupId`**

In `src/state.ts`, add to the `LayerBase` type (after `visible: boolean;`):

```ts
  groupId?: string; // shared across grouped layers; absent = ungrouped. ponytail: logical-only, no z-order reflow, no nesting.
```

- [ ] **Step 2: Update `AppState` and add `primaryId`**

Replace:

```ts
export type AppState = { doc: ThumbDoc; selectedId: string | null };
```

with:

```ts
export type AppState = { doc: ThumbDoc; selectedIds: string[] };

/** The layer that drives the single-layer Inspector — the last one selected. */
export const primaryId = (s: AppState): string | null => s.selectedIds[s.selectedIds.length - 1] ?? null;
```

- [ ] **Step 3: Update the `Action` union**

Replace the `Action` type with:

```ts
export type Action =
  | { type: "loadDoc"; doc: ThumbDoc } // template / saved config / imported file
  | { type: "select"; ids: string[] }
  | { type: "addLayer"; layer: Layer }
  | { type: "pasteLayer"; layer: Layer } // clone of `layer`, inserted above the selection
  | { type: "updateLayer"; id: string; patch: LayerPatch }
  | { type: "nudge"; ids: string[]; dx: number; dy: number } // drag delta for a set
  | { type: "setPositions"; positions: { id: string; x: number; y: number }[] } // absolute batch move (align/distribute)
  | { type: "removeLayer"; id: string }
  | { type: "removeLayers"; ids: string[] }
  | { type: "reorder"; id: string; dir: -1 | 1 } // move one step in z-order
  | { type: "group"; ids: string[] }
  | { type: "ungroup"; ids: string[] }
  | { type: "updateBackground"; patch: Partial<Background> };
```

- [ ] **Step 4: Update the reducer**

Replace the whole `reducer` function body's `switch` cases as follows (keep `mapLayer` above it unchanged):

```ts
export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "loadDoc":
      return { doc: migrateDoc(action.doc), selectedIds: [] };
    case "select":
      return { ...state, selectedIds: action.ids };
    case "addLayer":
      return { doc: { ...state.doc, layers: [...state.doc.layers, action.layer] }, selectedIds: [action.layer.id] };
    case "pasteLayer": {
      // ponytail: +24px offset so the clone is visibly distinct from its source.
      const clone = { ...action.layer, id: uid(), x: action.layer.x + 24, y: action.layer.y + 24 } as Layer;
      const layers = [...state.doc.layers];
      const anchor = primaryId(state);
      const i = anchor ? layers.findIndex((l) => l.id === anchor) : -1;
      layers.splice(i >= 0 ? i + 1 : layers.length, 0, clone); // i+1 = directly above the selection
      return { doc: { ...state.doc, layers }, selectedIds: [clone.id] };
    }
    case "updateLayer":
      return { ...state, doc: mapLayer(state.doc, action.id, (l) => Object.assign({}, l, action.patch) as Layer) };
    case "nudge": {
      const set = new Set(action.ids);
      return { ...state, doc: { ...state.doc, layers: state.doc.layers.map((l) => (set.has(l.id) ? { ...l, x: l.x + action.dx, y: l.y + action.dy } : l)) } };
    }
    case "setPositions": {
      const m = new Map(action.positions.map((p) => [p.id, p]));
      return { ...state, doc: { ...state.doc, layers: state.doc.layers.map((l) => { const p = m.get(l.id); return p ? { ...l, x: p.x, y: p.y } : l; }) } };
    }
    case "removeLayer":
      return {
        doc: { ...state.doc, layers: state.doc.layers.filter((l) => l.id !== action.id) },
        selectedIds: state.selectedIds.filter((id) => id !== action.id),
      };
    case "removeLayers": {
      const set = new Set(action.ids);
      return {
        doc: { ...state.doc, layers: state.doc.layers.filter((l) => !set.has(l.id)) },
        selectedIds: state.selectedIds.filter((id) => !set.has(id)),
      };
    }
    case "reorder": {
      const layers = [...state.doc.layers];
      const i = layers.findIndex((l) => l.id === action.id);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= layers.length) return state;
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...state, doc: { ...state.doc, layers } };
    }
    case "group": {
      const gid = uid();
      const set = new Set(action.ids);
      return { ...state, doc: { ...state.doc, layers: state.doc.layers.map((l) => (set.has(l.id) ? { ...l, groupId: gid } : l)) } };
    }
    case "ungroup": {
      const set = new Set(action.ids);
      return {
        ...state,
        doc: {
          ...state.doc,
          layers: state.doc.layers.map((l) => {
            if (!set.has(l.id)) return l;
            const { groupId: _drop, ...rest } = l;
            return rest as Layer;
          }),
        },
      };
    }
    case "updateBackground":
      return { ...state, doc: { ...state.doc, background: { ...state.doc.background, ...action.patch } } };
  }
}
```

- [ ] **Step 5: Update `gestureTag`**

Replace the `nudge` case (and keep the others):

```ts
function gestureTag(action: Action): string | null {
  switch (action.type) {
    case "nudge":
      return `nudge:${[...action.ids].sort().join(",")}`;
    case "updateLayer":
      return `update:${action.id}:${Object.keys(action.patch).sort().join(",")}`;
    case "updateBackground":
      return `bg:${Object.keys(action.patch).sort().join(",")}`;
    default:
      return null;
  }
}
```

- [ ] **Step 6: Update `src/state.test.ts`**

Change the `start` helper and every `select`/`selectedId` reference:

```ts
const start = (): AppState => ({ doc: emptyDoc, selectedIds: [] });
```

Replace `{ type: "select", id: a.id }` → `{ type: "select", ids: [a.id] }`, `{ type: "select", id: null }` → `{ type: "select", ids: [] }`, and read `h.present.selectedIds[h.present.selectedIds.length - 1]` (or import and use `primaryId`) where the test previously read `h.present.selectedId`. Concretely, in the paste test:

```ts
import { primaryId } from "./state"; // add to the import block
// …
const selectedId = primaryId(h.present);
```

- [ ] **Step 7: Update `src/App.tsx`**

- Line 16 import: add `primaryId` to the `./state` import.
- Line 19: `const initial: AppState = { doc: TEMPLATES.dacoder(), selectedIds: [] };`
- Line 48–53 block: replace with:

```ts
  const { doc, selectedIds } = hist.present;
  const dirty = hydrated && doc !== savedDocRef.current;

  const primary = selectedIds[selectedIds.length - 1] ?? null;
  // Crop tooling is per-selection; drop it whenever the selected layer changes.
  useEffect(() => setCropMode(null), [primary]);
  const selected = doc.layers.find((l) => l.id === primary) ?? null;
```

- Lines 65–66 (`selRef`): rename to track the array:

```ts
  const selRef = useRef(selectedIds);
  selRef.current = selectedIds;
```

- Line 148 (copy): `const l = docRef.current.layers.find((x) => x.id === selRef.current[selRef.current.length - 1]); if (l) clipboardRef.current = l;`
- Line 155 (delete): `if (selRef.current.length) dispatch({ type: "removeLayers", ids: selRef.current });`
- Line 297: `<LayerList layers={doc.layers} selectedIds={selectedIds} dispatch={dispatch} />`
- Line 319: `selectedIds={selectedIds}`

(The ⌘G/⌘⇧G shortcuts are added in Task 5.)

- [ ] **Step 8: Update `src/components/ThumbCanvas.tsx` (compile-only, behavior preserved)**

- Props type (line 107): `selectedIds: string[];`
- Destructure (line 117): replace `selectedId` with `selectedIds`.
- Add just below destructure: `const primary = selectedIds[selectedIds.length - 1] ?? null;`
- `startDrag` (line 132): `dispatch({ type: "select", id });` → `dispatch({ type: "select", ids: [id] });` and the streamed `nudge`:
  `dispatch({ type: "nudge", ids: [id], dx: (ev.clientX - last.x) / scale, dy: (ev.clientY - last.y) / scale });`
- Root `onPointerDown` (line 149): `dispatch({ type: "select", id: null })` → `dispatch({ type: "select", ids: [] })`.
- Line 185: `layer.id === selectedId` → `layer.id === primary`.
- Line 203: `layer.id === selectedId` → `layer.id === primary`.

- [ ] **Step 9: Update `src/components/LayerList.tsx` (compile-only)**

- Props (line 17): `selectedId: string | null` → `selectedIds: string[]`.
- Signature (line 20): destructure `selectedIds`.
- Line 31: `const active = selectedIds.includes(layer.id);`
- Line 35: `onClick={() => dispatch({ type: "select", ids: [layer.id] })}`
- Line 81: `dispatch({ type: "select", id: layer.id })` → `dispatch({ type: "select", ids: [layer.id] })`.

- [ ] **Step 10: Run the type check and tests**

Run: `bun run check && bun test`
Expected: no type errors; all tests pass (existing state tests, updated, plus Task 1's layout tests). If `bun run check` flags `Inspector.tsx` or any other file for a stale `selectedId`, fix it the same way (read `primary`).

- [ ] **Step 11: Manual smoke test**

Run: `bun run dev`, open http://localhost:5174. Confirm the editor behaves as before: click selects a layer, drag moves it, Delete removes it, undo/redo works, copy/paste (⌘C/⌘V) works.

- [ ] **Step 12: Commit**

```bash
git add src/state.ts src/state.test.ts src/App.tsx src/components/ThumbCanvas.tsx src/components/LayerList.tsx
git commit -m "refactor(state): selectedIds array + groupId + multi-move actions

Migrates single selectedId to selectedIds[]; adds groupId, nudge(ids),
setPositions, group/ungroup, removeLayers. Behavior unchanged (single-select).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Drag snapping + alignment guides (`ThumbCanvas`)

Rewrites the drag path to snap the dragged set's bounding box to canvas + other-layer lines, with sticky break-out, and renders live guide lines.

**Files:**
- Modify: `src/components/ThumbCanvas.tsx`

**Interfaces:**
- Consumes: `resolveSnap`, `type Box` from `src/lib/layout.ts`; `nudge { ids, dx, dy }` from `src/state.ts`.
- Produces: internal only (`layerBox`, `dragSetOf`, `guides` state) — no exports.

- [ ] **Step 1: Add imports**

At the top of `ThumbCanvas.tsx`, add `useRef` to the React import and import the geometry helpers:

```ts
import { useRef, useState, type CSSProperties, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { resolveSnap, type Box } from "../lib/layout";
```

- [ ] **Step 2: Add box + guide helpers and guide state inside `ThumbCanvas`**

Just after `const primary = …` (from Task 2), add:

```ts
  // Ephemeral snap guides shown only during a drag (never during export).
  const [guides, setGuides] = useState<{ vx: number | null; hy: number | null }>({ vx: null, hy: null });

  // A layer's rendered box in canvas units (offsetWidth/Height are layout px =
  // canvas units, since the canvas is scaled by a CSS transform, not layout).
  const layerBox = (id: string): Box | null => {
    const el = canvasRef.current?.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);
    const l = doc.layers.find((x) => x.id === id);
    if (!el || !l) return null;
    return { x: l.x, y: l.y, w: el.offsetWidth, h: el.offsetHeight };
  };

  const SNAP = 6 / scale;   // grab distance
  const BREAK = 12 / scale; // effort to leave a snapped line
```

- [ ] **Step 3: Rewrite `startDrag` to snap the whole selection**

Replace the entire `startDrag` function with:

```ts
  /** pointerdown on a layer: select it (unless already selected), then stream a
   *  snapped drag over the whole current selection. */
  function startDrag(e: ReactPointerEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();

    // Drag set: keep the current selection if this layer is in it, else select just it.
    const dragIds = selectedIds.includes(id) ? selectedIds : [id];
    if (!selectedIds.includes(id)) dispatch({ type: "select", ids: [id] });

    // Union bbox of the drag set, and candidate snap lines from every other layer + canvas.
    const boxes = dragIds.map(layerBox).filter((b): b is Box => b !== null);
    if (boxes.length === 0) return;
    const minX = Math.min(...boxes.map((b) => b.x)), minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w)), maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const start = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

    const setIds = new Set(dragIds);
    const xLines = [0, CANVAS_W / 2, CANVAS_W];
    const yLines = [0, CANVAS_H / 2, CANVAS_H];
    for (const l of doc.layers) {
      if (setIds.has(l.id) || !l.visible) continue;
      const b = layerBox(l.id);
      if (!b) continue;
      xLines.push(b.x, b.x + b.w / 2, b.x + b.w);
      yLines.push(b.y, b.y + b.h / 2, b.y + b.h);
    }

    const startClient = { x: e.clientX, y: e.clientY };
    let applied = { x: start.x, y: start.y };
    let sticky: { vx: number | null; hy: number | null } = { vx: null, hy: null };

    const move = (ev: PointerEvent) => {
      const raw = { x: start.x + (ev.clientX - startClient.x) / scale, y: start.y + (ev.clientY - startClient.y) / scale };
      const r = resolveSnap(raw, { w: start.w, h: start.h }, xLines, yLines, sticky, SNAP, BREAK);
      sticky = { vx: r.vx, hy: r.hy };
      const dx = r.x - applied.x, dy = r.y - applied.y;
      if (dx !== 0 || dy !== 0) dispatch({ type: "nudge", ids: dragIds, dx, dy });
      applied = { x: r.x, y: r.y };
      setGuides({ vx: r.vx, hy: r.hy });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuides({ vx: null, hy: null });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
```

- [ ] **Step 4: Render the guide lines**

Inside the canvas root `<div>`, just before the closing `</div>` that wraps the layers (after the `{drawMode && ( … )}` block), add:

```tsx
      {guides.vx != null && (
        <div style={{ position: "absolute", left: guides.vx, top: 0, width: 1.5 / scale, height: CANVAS_H, background: SELECT_COLOR, pointerEvents: "none", zIndex: 60 }} />
      )}
      {guides.hy != null && (
        <div style={{ position: "absolute", top: guides.hy, left: 0, height: 1.5 / scale, width: CANVAS_W, background: SELECT_COLOR, pointerEvents: "none", zIndex: 60 }} />
      )}
```

- [ ] **Step 5: Type check**

Run: `bun run check`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `bun run dev`. Drag a layer:
- Near horizontal/vertical canvas center → a blue guide appears and the layer snaps to it.
- Drag slowly past the line → it holds briefly (sticky), then breaks free for a deliberate offset.
- Drag one layer's edge toward another layer's edge/center → guide appears and snaps.
- Release → guides vanish. Undo (⌘Z) reverses the whole drag in one step.
- Export a PNG → no guide lines in the output.

- [ ] **Step 7: Commit**

```bash
git add src/components/ThumbCanvas.tsx
git commit -m "feat(canvas): sticky alignment guides while dragging

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Multi-selection interactions (`ThumbCanvas` + `LayerList`)

Shift-click, double-click drill-in, marquee, group-aware selection, and a multi-select outline.

**Files:**
- Modify: `src/components/ThumbCanvas.tsx`
- Modify: `src/components/LayerList.tsx`

**Interfaces:**
- Consumes: `boxesIntersect`, `type Box` from `src/lib/layout.ts`; `select { ids }` from state.
- Produces: internal helpers `groupMates`, `expandGroups` (defined in both files independently — small and local; DRY across files isn't worth a shared import for two 3-line helpers).

- [ ] **Step 1: Add group-aware helpers + marquee state in `ThumbCanvas`**

Add `boxesIntersect` to the layout import:

```ts
import { boxesIntersect, resolveSnap, type Box } from "../lib/layout";
```

Just after the `layerBox` helper, add:

```ts
  const [marquee, setMarquee] = useState<Box | null>(null);

  // All ids in a layer's group (or just itself if ungrouped).
  const groupMates = (layer: Layer): string[] =>
    layer.groupId ? doc.layers.filter((l) => l.groupId === layer.groupId).map((l) => l.id) : [layer.id];

  // Expand a set of ids to include every group-mate, deduped.
  const expandGroups = (ids: string[]): string[] => {
    const out = new Set<string>();
    for (const id of ids) {
      const l = doc.layers.find((x) => x.id === id);
      if (l) for (const m of groupMates(l)) out.add(m);
    }
    return [...out];
  };
```

- [ ] **Step 2: Make layer click/shift-click/double-click group-aware**

At the top of `startDrag`, replace the drag-set selection logic (the two lines computing `dragIds` and the conditional `dispatch`) with group + shift handling:

```ts
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer) return;
    const mates = groupMates(layer);

    // Shift-click toggles this layer (or its whole group) in/out of the selection — no drag.
    if (e.shiftKey) {
      const has = mates.every((m) => selectedIds.includes(m));
      const next = has
        ? selectedIds.filter((s) => !mates.includes(s))
        : [...selectedIds, ...mates.filter((m) => !selectedIds.includes(m))];
      dispatch({ type: "select", ids: next });
      return;
    }

    // Plain click on a layer already in the selection keeps it (so a group drags together);
    // otherwise select the group (or the single layer). Dispatch select UNCONDITIONALLY —
    // even when the selection is unchanged — because `select` is the only action that resets
    // history.tag to null, which is what makes each drag its own undo entry. Skipping it when
    // already-selected merges consecutive drags of the same layer into one undo step.
    const alreadyIn = selectedIds.includes(id);
    const dragIds = alreadyIn ? selectedIds : mates;
    dispatch({ type: "select", ids: dragIds });
```

Then add a double-click handler on the layer box. In the layer `.map(...)` render, add to the layer `<div>` (next to `onPointerDown`):

```tsx
            onDoubleClick={(e) => { e.stopPropagation(); dispatch({ type: "select", ids: [layer.id] }); }}
```

- [ ] **Step 3: Replace the root pointer handler with marquee + clear**

Replace the root `<div>`'s `onPointerDown={() => { … }}` with `onPointerDown={startMarquee}` and add the `startMarquee` function next to `startDrag`:

```ts
  /** pointerdown on empty canvas: a drag draws a marquee (box-select); a click clears. */
  function startMarquee(e: ReactPointerEvent) {
    setCropMode(null);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const additive = e.shiftKey;
    const base = additive ? selectedIds : [];
    const toCanvas = (cx: number, cy: number) => ({ x: (cx - rect.left) / scale, y: (cy - rect.top) / scale });
    const p0 = toCanvas(e.clientX, e.clientY);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = toCanvas(ev.clientX, ev.clientY);
      const box = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      if (box.w > 3 || box.h > 3) moved = true;
      setMarquee(box);
      if (moved) {
        const hit = doc.layers.filter((l) => l.visible).filter((l) => { const b = layerBox(l.id); return b && boxesIntersect(b, box); }).map((l) => l.id);
        dispatch({ type: "select", ids: expandGroups([...base, ...hit]) });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (!moved && !additive) dispatch({ type: "select", ids: [] }); // plain click clears
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
```

- [ ] **Step 4: Render the marquee rectangle**

Next to the guide-line render (Task 3, Step 4), add:

```tsx
      {marquee && (
        <div style={{ position: "absolute", left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, border: `${1 / scale}px solid ${SELECT_COLOR}`, background: `${SELECT_COLOR}22`, pointerEvents: "none", zIndex: 60 }} />
      )}
```

- [ ] **Step 5: Multi-select outline (no handles) vs single-select frame**

Replace the selection-frame render block (currently `{!exporting && layer.id === primary && ( <SelectionFrame …/> )}`) with:

```tsx
            {!exporting && selectedIds.includes(layer.id) && (
              selectedIds.length === 1 ? (
                <SelectionFrame
                  layer={layer}
                  scale={scale}
                  cropMode={layerCrop}
                  onCropDone={() => setCropMode(null)}
                  canvasRef={canvasRef}
                  dispatch={dispatch}
                />
              ) : (
                // ponytail: multi-select shows a per-layer outline only; multi-resize/rotate handles are a later add.
                <div style={{ position: "absolute", inset: -3 / scale, border: `${1.5 / scale}px solid ${SELECT_COLOR}`, pointerEvents: "none", boxSizing: "border-box" }} />
              )
            )}
```

- [ ] **Step 6: Group-aware selection in `LayerList`**

In `LayerList.tsx`, add group helpers inside the component (before the `return`):

```ts
  const groupMates = (layer: Layer): string[] =>
    layer.groupId ? layers.filter((l) => l.groupId === layer.groupId).map((l) => l.id) : [layer.id];
```

Replace the row `onClick` (line 35) with a shift-aware, group-aware handler:

```tsx
              onClick={(e) => {
                const mates = groupMates(layer);
                if (e.shiftKey) {
                  const has = mates.every((m) => selectedIds.includes(m));
                  dispatch({ type: "select", ids: has ? selectedIds.filter((s) => !mates.includes(s)) : [...selectedIds, ...mates.filter((m) => !selectedIds.includes(m))] });
                } else {
                  dispatch({ type: "select", ids: mates });
                }
              }}
```

Add `Layer` to the type import at the top if not already present:

```ts
import type { Action, Layer, LayerType } from "../state";
```

- [ ] **Step 7: Type check**

Run: `bun run check`
Expected: no errors.

- [ ] **Step 8: Manual verification**

Run: `bun run dev`.
- Shift-click two layers on the canvas → both show outlines; drag one → both move together with snapping.
- Drag on empty canvas → a marquee box appears; layers it touches get selected; shift+marquee adds.
- Click empty (no drag) → clears selection.
- Shift-click rows in the layer list → toggles; all selected rows highlight.

- [ ] **Step 9: Commit**

```bash
git add src/components/ThumbCanvas.tsx src/components/LayerList.tsx
git commit -m "feat(canvas): multi-select via shift-click, marquee, group-aware clicks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Grouping + align/distribute UI (`Inspector`, `App`, `LayerList`)

The "Allinea" inspector section, ⌘G/⌘⇧G shortcuts, and a group badge in the layer list.

**Files:**
- Modify: `src/components/Inspector.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/LayerList.tsx`

**Interfaces:**
- Consumes: `alignBoxes`, `distributeBoxes`, `type Placed`, `type AlignEdge` from `src/lib/layout.ts`; `select`/`group`/`ungroup`/`setPositions` actions.
- Produces: `Inspector` gains props `selectedIds: string[]` and `layers: Layer[]`.

- [ ] **Step 1: Inspect the current `Inspector` signature**

Run: `sed -n '1,40p' src/components/Inspector.tsx`
Note the exported `Inspector` component's prop type and how sections are composed (`Section`, `Button` from `./ui/button`, `./controls`). The new section reuses those primitives.

- [ ] **Step 2: Add the align/group section props and imports to `Inspector`**

Add to the `Inspector` prop type: `selectedIds: string[];` and `layers: Layer[];`. Add imports:

```ts
import { alignBoxes, distributeBoxes, type AlignEdge, type Placed } from "../lib/layout";
import {
  AlignHorizontalJustifyCenter, AlignHorizontalJustifyStart, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween, Group, Ungroup,
} from "lucide-react";
```

(If any icon name is missing in this lucide version, `bun run check` will flag it — substitute the nearest available align icon; the behavior is unaffected.)

- [ ] **Step 3: Add the align section component to `Inspector.tsx`**

Add this component in the file and render `<AlignSection …/>` at the top of the `Inspector`'s returned JSX (before the single-layer sections), so it shows above the per-layer controls:

```tsx
/** Measure a selected layer's rendered box (canvas units) straight from the DOM. */
function placedOf(id: string, layers: Layer[]): Placed | null {
  const el = document.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);
  const l = layers.find((x) => x.id === id);
  if (!el || !l) return null;
  return { id, box: { x: l.x, y: l.y, w: el.offsetWidth, h: el.offsetHeight } };
}

function AlignSection({ selectedIds, layers, dispatch }: { selectedIds: string[]; layers: Layer[]; dispatch: Dispatch<Action> }) {
  if (selectedIds.length < 2) return null;
  const placed = () => selectedIds.map((id) => placedOf(id, layers)).filter((p): p is Placed => p !== null);
  const align = (edge: AlignEdge) => dispatch({ type: "setPositions", positions: alignBoxes(placed(), edge) });
  const distribute = (axis: "h" | "v") => dispatch({ type: "setPositions", positions: distributeBoxes(placed(), axis) });
  const hasGroup = selectedIds.some((id) => layers.find((l) => l.id === id)?.groupId);
  const canDistribute = selectedIds.length >= 3;

  const btn = "flex h-8 flex-1 items-center justify-center rounded-md border border-border hover:bg-accent [&_svg]:size-4";
  return (
    <Section title={`Allinea · ${selectedIds.length} livelli`}>
      <div className="space-y-1.5">
        <div className="flex gap-1">
          <button className={btn} title="Allinea a sinistra" onClick={() => align("left")}><AlignHorizontalJustifyStart /></button>
          <button className={btn} title="Centra orizzontalmente" onClick={() => align("hcenter")}><AlignHorizontalJustifyCenter /></button>
          <button className={btn} title="Allinea a destra" onClick={() => align("right")}><AlignHorizontalJustifyEnd /></button>
          <button className={btn} title="Allinea in alto" onClick={() => align("top")}><AlignVerticalJustifyStart /></button>
          <button className={btn} title="Centra verticalmente" onClick={() => align("vcenter")}><AlignVerticalJustifyCenter /></button>
          <button className={btn} title="Allinea in basso" onClick={() => align("bottom")}><AlignVerticalJustifyEnd /></button>
        </div>
        <div className="flex gap-1">
          <button className={btn} disabled={!canDistribute} title="Distribuisci orizzontalmente" onClick={() => distribute("h")}><AlignHorizontalSpaceBetween /></button>
          <button className={btn} disabled={!canDistribute} title="Distribuisci verticalmente" onClick={() => distribute("v")}><AlignVerticalSpaceBetween /></button>
          <button className={btn} title="Raggruppa (⌘G)" onClick={() => dispatch({ type: "group", ids: selectedIds })}><Group /></button>
          <button className={btn} disabled={!hasGroup} title="Separa (⌘⇧G)" onClick={() => dispatch({ type: "ungroup", ids: selectedIds })}><Ungroup /></button>
        </div>
      </div>
    </Section>
  );
}
```

Ensure `Dispatch`, `Action`, `Layer`, and `Section` are imported in `Inspector.tsx` (add any missing ones). Render inside the `Inspector` body:

```tsx
  return (
    <>
      <AlignSection selectedIds={selectedIds} layers={layers} dispatch={dispatch} />
      {/* …existing single-layer inspector JSX… */}
    </>
  );
```

(If `Inspector` already returns a fragment or a single root, place `<AlignSection …/>` as its first child.)

- [ ] **Step 4: Pass the new props from `App.tsx`**

At line 343, update the `Inspector` usage:

```tsx
            <Inspector selected={selected} selectedIds={selectedIds} layers={doc.layers} dispatch={dispatch} onError={setMessage} cropMode={cropMode} setCropMode={setCropMode} onFontPreview={setFontPreview} />
```

- [ ] **Step 5: Add ⌘G / ⌘⇧G shortcuts in `App.tsx`**

In the `onKey` handler, inside the `if (mod) { … }` block (after the `y` redo case, before the final `return`), add:

```ts
        if (k === "g") {
          e.preventDefault();
          if (e.shiftKey) {
            if (selRef.current.length) dispatch({ type: "ungroup", ids: selRef.current });
          } else if (selRef.current.length >= 2) {
            dispatch({ type: "group", ids: selRef.current });
          }
          return;
        }
```

- [ ] **Step 6: Group badge in `LayerList`**

Add `Link2` to the lucide import in `LayerList.tsx`, and render a small badge when `layer.groupId` is set — insert after the type-icon `<span>` (line 53):

```tsx
              {layer.groupId && <Link2 className="size-3 shrink-0 text-muted-foreground" aria-label="Raggruppato" />}
```

- [ ] **Step 7: Type check + tests**

Run: `bun run check && bun test`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Manual verification**

Run: `bun run dev`.
- Select 2+ layers → "Allinea" section appears. Click each align button → layers snap to the correct edge/center. With 3+, distribute evens the gaps; with 2, distribute buttons are disabled.
- Click "Raggruppa" or press ⌘G → layers become a group (badge appears in the layer list). Clicking one member now selects all; double-click on canvas drills into one.
- ⌘⇧G or "Separa" → ungroups.
- Undo (⌘Z) reverses each align/group/ungroup as a single step.

- [ ] **Step 9: Commit**

```bash
git add src/components/Inspector.tsx src/App.tsx src/components/LayerList.tsx
git commit -m "feat(inspector): align/distribute + grouping UI and shortcuts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run `bun run check` — passes.
- [ ] Run `bun test` — passes.
- [ ] Full manual pass over the spec's Verification section (guides, marquee, align/distribute, group drag, multi-delete, undo granularity, export has no guides).

## Self-review notes (coverage vs spec)

- §1 state model → Task 2. §2 snapping/guides → Task 3. §3 multi-select interactions → Task 4. §4 align/distribute + group UI → Task 5. Pure math (§2/§4) → Task 1.
- Deliberate simplifications carried from spec, marked `// ponytail:`: logical-only groups (Task 2), no multi-resize handles (Task 4), rotation-ignored snap/align (implicit in DOM box measurement), single-layer copy/paste (unchanged).
