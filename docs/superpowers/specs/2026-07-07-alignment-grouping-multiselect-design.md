# Alignment guides, grouping, and multi-selection

**Date:** 2026-07-07
**Status:** Approved design, pending implementation

Three interlocking editor features for the thumbnail canvas:

1. **Alignment guides + sticky snapping** while dragging a layer.
2. **Grouping** — layers that select and move together (⌘G / ⌘⇧G + UI).
3. **Multi-selection** — shift-click, marquee, and align/distribute operations.

They interlock: a group is a persisted multi-selection; both need a
selection-array state model; snapping and alignment both need each layer's
rendered box, which is read from the DOM (layer boxes live in canvas-unit space
because the canvas is scaled by a CSS `transform`, not by layout).

---

## 1. State model — `src/state.ts`

### Layer schema

`LayerBase` gains one optional field:

```ts
type LayerBase = {
  // …existing…
  groupId?: string; // shared id across grouped layers; absent = ungrouped
};
```

No migration: the field is optional, so old docs read as ungrouped. Grouping is
**logical only** — `groupId` tags membership but does not reorder the layer
array or force members to be contiguous in paint order. No nesting: a layer
belongs to at most one group.

### Selection

`AppState.selectedId: string | null` becomes:

```ts
export type AppState = { doc: ThumbDoc; selectedIds: string[] };
```

- `[]` = nothing selected.
- The **primary** layer (drives the single-layer Inspector) is the last element:
  `selectedIds[selectedIds.length - 1]`.
- A small helper `primaryId(state)` returns that or `null`.

### Actions

Changed:

- `select { ids: string[] }` — replaces the whole selection (was `{ id }`).
  Empty array clears.
- `nudge { ids: string[]; dx: number; dy: number }` — move a set by a delta
  (was single `id`). Used by all canvas drags (single-layer drag passes one id).

New:

- `setPositions { positions: { id: string; x: number; y: number }[] }` —
  discrete absolute batch move for align/distribute. One history entry.
- `group { ids: string[] }` — assign a fresh `groupId` (via `uid()`) to every id.
- `ungroup { ids: string[] }` — clear `groupId` on every id.
- `removeLayers { ids: string[] }` — delete a multi-selection; clears any of
  those ids from `selectedIds`.

Unchanged: `updateLayer` (single), `reorder`, `pasteLayer`, `addLayer`,
`updateBackground`, `loadDoc`.

### History / gesture coalescing

`gestureTag` updates:

- `nudge` → `nudge:<ids sorted, joined>` so a whole drag (single or multi)
  collapses into one undo entry.
- `setPositions`, `group`, `ungroup`, `removeLayers` → discrete (own entry).
- `updateLayer` / `updateBackground` unchanged.

`historyReducer`: `select` stays non-undoable (updates `present`, tag `null`).

---

## 2. Snapping + guides — `src/components/ThumbCanvas.tsx`

### Reading boxes

A layer's rendered box in canvas units:

```
el = canvas.querySelector(`[data-layer-id="${id}"]`)
box = { x: layer.x, y: layer.y, w: el.offsetWidth, h: el.offsetHeight }
```

`offsetWidth/Height` are layout px = canvas units (the CSS `scale()` transform
does not affect layout). Rotation is ignored (layout box used) — same
simplification as the existing crop code.

### Drag with snapping

`startDrag` becomes drag-set aware:

1. On pointerdown on a layer, determine the **drag set**: if the pressed layer
   is already in `selectedIds`, drag the current selection; otherwise select it
   (group-aware — see §3) and drag that.
2. Compute the drag set's union bounding box from the DOM.
3. Track the **raw** (unsnapped) bbox top-left as
   `rawX = startBoxX + (ev.clientX - startClientX) / scale` (and y).
4. **Candidate snap lines:**
   - Vertical (x): canvas `0, 640, 1280`; every non-dragged layer's
     `left, centerX, right`.
   - Horizontal (y): canvas `0, 360, 720`; every non-dragged layer's
     `top, centerY, bottom`.
5. **Moving points:** the dragged bbox's `left, centerX, right` (vs x-lines) and
   `top, centerY, bottom` (vs y-lines).
6. **Snap threshold** `SNAP = 6 / scale`. For each axis, pick the nearest
   (movingPoint, line) pair within `SNAP` and shift the box so the point lands
   on the line.
7. **Sticky break (hysteresis):** keep the active snapped line per axis in a ref.
   While snapped to line `L`, stay snapped until the raw moving point is more
   than `BREAK = 12 / scale` from `L`; only then recompute. This is the "effort
   to break out" behaviour — a deliberate misalignment is possible by dragging
   past the break distance.
8. **Apply:** dispatch `nudge { ids, dx, dy }` with the delta from the last
   applied position to the snapped position; track last-applied locally so
   deltas stay correct across frames.
9. **Guides:** ephemeral React state `{ vx?: number; hy?: number }` holds the
   active snapped canvas coordinates. Render full-span lines (1.5px / scale,
   `SELECT_COLOR`) at those coordinates. Cleared on pointer-up — so guides never
   appear in export (drag is over before capture).

Single, multi, and group drags use the identical path (bbox = union of the set).

### Selection frame

- **Single selection:** unchanged — full resize/rotate/crop handles.
- **Multi selection (≥2):** a non-interactive combined bbox outline only. No
  multi-resize handles (align/distribute covers layout; multi-resize is a noted
  upgrade path).

---

## 3. Multi-selection & grouping interactions

### Canvas (`ThumbCanvas`)

- **Plain click on a layer:** select it. Group-aware: if the layer has a
  `groupId`, select all members of that group.
- **Shift+click on a layer:** toggle it (group-aware: toggles the whole group)
  in/out of `selectedIds`.
- **Double-click a grouped layer:** drill in — select only that single member,
  bypassing the group.
- **Drag on a layer:** moves the drag set (§2).
- **Marquee:** pointerdown on the canvas background starts a potential marquee.
  Past a few px of movement, render a selection rectangle (screen→canvas via
  `canvasRef` rect). On release, select every layer whose box intersects the
  rect (group-aware; Shift = additive to the current selection). A plain click
  with no drag still clears the selection (existing behaviour).

### App (`src/App.tsx`)

- `selectedIds` wired through; primary derived for the Inspector.
- Key handler additions (guarded by the existing "typing in a field" check):
  - **⌘G / Ctrl+G:** if `selectedIds.length >= 2`, dispatch `group`.
  - **⌘⇧G / Ctrl+⇧G:** if the selection contains any grouped layer, dispatch
    `ungroup`.
  - **Delete / Backspace:** `removeLayers { ids: selectedIds }`.
- Copy/paste stays single-layer (copies the primary) for now — noted upgrade.

### Layer list (`src/components/LayerList.tsx`)

- Highlights **all** selected rows.
- Plain click selects (group-aware — selects the whole group).
- Shift+click toggles (group-aware).
- A small group badge/icon marks grouped rows.

---

## 4. Alignment / distribute + group UI — `src/components/Inspector.tsx`

A new **"Allinea"** section renders when `selectedIds.length >= 2`:

- **Align (6):** left / horizontal-center / right, top / vertical-center /
  bottom.
- **Distribute (2):** horizontal, vertical — enabled only at `>= 3` selected.
- **Group (⌘G) / Ungroup (⌘⇧G)** buttons (mirror the shortcuts). Group enabled
  at `>= 2`; Ungroup enabled when the selection contains a group.

Math (all in canvas units, boxes read from the DOM):

- Align left: `x = min(left)`; h-center: `x = bboxCenterX - w/2`;
  right: `x = max(right) - w`. Top/middle/bottom analogous on y/h.
- Distribute H: sort by centerX, hold first & last, equal gaps between the rest;
  vertical analogous.

Emits one `setPositions` action (single undo entry).

---

## Files touched

| File | Change |
|------|--------|
| `src/state.ts` | `groupId`, `selectedIds`, new/changed actions, reducer cases, `gestureTag` |
| `src/components/ThumbCanvas.tsx` | drag set + snapping + guides + marquee + multi selection frame + group-aware click/double-click |
| `src/App.tsx` | `selectedIds` wiring, ⌘G/⌘⇧G/Delete handlers, primary derivation |
| `src/components/Inspector.tsx` | "Allinea" section: align/distribute/group/ungroup |
| `src/components/LayerList.tsx` | multi-highlight, shift-click, group-aware select, group badge |

## Non-goals / deliberate simplifications (mark with `// ponytail:`)

- No nested groups; grouping is logical-only (no z-order reflow).
- No multi-select resize/rotate handles — align/distribute covers layout.
- Snap/align math ignores rotation (uses the layout box).
- Copy/paste stays single-layer (primary only).

## Verification

Manual, in `bun run dev` (no test suite in this repo; `bun run check` is the
gate):

- Drag a layer near canvas center → guide appears and it snaps; drag harder →
  breaks free for a deliberate offset.
- Shift-click two layers, marquee-select three → align left/center/right and
  top/middle/bottom land correctly; distribute evens gaps at ≥3.
- ⌘G groups; clicking one member selects all; double-click drills into one;
  ⌘⇧G ungroups. Group drag moves all members with snapping on the union box.
- Delete removes the whole selection. Undo (⌘Z) reverses each drag/align/group
  as a single step.
- `bun run check` passes.
