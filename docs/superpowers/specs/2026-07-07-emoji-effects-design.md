# Emoji effects ("Effetti emoji") — design

Decorative fields of emojis (confetti, fireworks, sparkles, orbits) that wrap a
target image, straddling it in z-order so some emojis sit **behind** the image
and some **in front** — the "3D / 360° orbit" look. UI strings are Italian.

## Why bound, not standalone

The document is a flat, ordered layer array where **array order === paint order**
(back → front) and no layer sets a `z-index` (see `ThumbCanvas.tsx`). A single
free-floating layer therefore paints entirely in front of or behind an image —
it cannot straddle it. The 360° effect *requires* straddling, so the effect is
**bound** to a target image: it references the image's id, centers on that
image's bounding box, and is rendered in two DOM pieces spliced around the image
(back-half before it, front-half after it). This preserves the array-order
invariant — no `z-index` is introduced anywhere.

## 1. Data model — `src/state.ts`

New layer type `emojifx` added to `LayerType`, `Layer`, `LayerPatch`.

```ts
export type EmojiFxLayer = LayerBase & {
  type: "emojifx";
  targetId: string | null;   // image layer this wraps; null = orphan (centered fallback)
  pattern: "ring" | "scatter" | "burst";
  glyphs: string[];          // multi-select set, distributed round-robin over `count`
  count: number;             // number of emoji instances
  size: number;              // base emoji px (1280×720 space); depth-scaled per emoji
  sizeJitter: number;        // 0–100 random size variance
  radius: number;            // ellipse radiusX (ring) / spread radius (scatter, burst), canvas units
  tilt: number;              // 0–1: radiusY = radius * tilt (flattens the ring into an orbit)
  depth: number;             // 0–100: front↔back scale & opacity contrast (the "3D")
  spin: number;              // 0–100 random per-emoji rotation amount
  seed: number;              // seeds the PRNG → arrangement stable across render/undo/save/export
};
```

`x`/`y` (from `LayerBase`) are unused while `targetId` resolves — the effect
centers on the target's bbox center. They are only used for the orphan fallback.

**Factory** `newEmojiFxLayer(targetId: string | null = null): EmojiFxLayer` with
sane defaults: `pattern: "ring"`, `glyphs: ["🎉","🎊","✨"]`, `count: 18`,
`size: 84`, `sizeJitter: 30`, `radius: 320`, `tilt: 0.45`, `depth: 55`,
`spin: 40`, `seed: <random>`. Seed derived once at creation via
`Math.floor(Math.random() * 1e9)` (`Math.random` is available in the browser).

**Glyph presets** (Italian labels, for inspector quick-fill buttons):
- Coriandoli — `🎉 🎊 ✨`
- Fuochi — `🎆 🎇 💥 ✨`
- Scintille — `✨ ⭐ 💫 🌟`
- Cuori — `❤️ 💕 💖 💗`

**Seeded PRNG** — a small `mulberry32(seed)` returning a `() => number` in
`[0,1)`. ~4 lines, lives in `state.ts` (or a tiny `src/lib/rng.ts`). Determinism
is required so the layout is stable across re-renders, undo/redo, save/reload,
and PNG export.

### Layout — one pure function

```ts
export type PlacedEmoji = { glyph: string; x: number; y: number; size: number; rotation: number; opacity: number; front: boolean };
export function layoutEmojiFx(layer: EmojiFxLayer, target: { cx: number; cy: number }): PlacedEmoji[];
```

`x`/`y` are absolute canvas coordinates (glyph center). Deterministic given
`layer.seed`. Per pattern:

- **ring** — emoji `i` at angle `θ = i/count * 2π + jitter`. Position on the
  ellipse: `cx + radius·cosθ`, `cy + radius·tilt·sinθ`. Depth `d = sinθ ∈ [-1,1]`;
  `front = d > 0` (bottom of the orbit is nearest → in front). `size` and
  `opacity` scale up with `d` proportional to `depth`.
- **scatter** — random point within the spread ellipse around the center;
  `front = rng() < 0.5`; a random per-emoji depth drives size & opacity. The
  "confetti cloud, some popping forward, some tucked behind" look.
- **burst** — random angle, distance `radius · √(rng())` (radiating from center,
  fireworks); depth random per emoji as in scatter.

All patterns apply `sizeJitter` and `spin` (random rotation) per emoji, driven by
the same seeded PRNG. Glyphs cycle round-robin (`glyphs[i % glyphs.length]`).

**Depth model (confirmed):** scatter & burst assign front/behind **randomly per
emoji**; ring uses `sin θ`.

**Multiplicity (confirmed):** multiple independent `emojifx` layers may target
the same image (e.g. sparkles + confetti). Each is its own layer and straddles
the same target.

### Reducer / history

`emojifx` needs no new actions — `addLayer`, `updateLayer`, `removeLayer`,
reorder, group, visibility all work as-is. Continuous inspector edits (slider
drags) already coalesce through the existing `updateLayer` gesture tag. No
`gestureTag` change needed.

## 2. Rendering — straddle splice — `src/components/ThumbCanvas.tsx`

In the `doc.layers.map(...)` block:

1. Pre-compute, per visible target image id, the list of `emojifx` layers
   targeting it (their layout split into `back = !front` and `front` sets).
2. `emojifx` layers themselves render **nothing** in their own map slot (they are
   skipped — their array position does not affect painting).
3. When rendering a layer that is an `emojifx` **target**, emit:
   `<>{backEmojiGroups}{normalLayerDiv}{frontEmojiGroups}</>`.
4. Emoji groups are absolutely-positioned, `pointerEvents: "none"` (never block
   selecting the image beneath), plain emoji `<span>`s (`fontSize`, `rotate`,
   `opacity`) → captured 1:1 by `html-to-image` on export.
5. **Orphan** (`targetId` null, or target hidden/deleted): render the whole field
   once, centered on canvas (`CANVAS_W/2, CANVAS_H/2`), all in one group, so the
   effect is still visible. Marked `// ponytail: orphan fallback — centered, no straddle`.

The target center is the image's bbox center, read the same way existing snap
code reads boxes (`layerBox`-style `offsetWidth/Height`, canvas units). Because
layout depends on the rendered image size, compute center from the layer's `x/y`
plus its measured box; a first-frame `null` measurement falls back to `x/y`
(one frame, like `ImageContent`'s aspect handling).

**No selection frame / no drag** for `emojifx`: it is bound and tuned via the
inspector. It is selected from the layer list (existing `LayerList`) to open its
inspector panel. `SelectionFrame`'s per-type resize branch gets no `emojifx`
case (it is never the single free-transform target on canvas).

## 3. UI

- **Toolbar** (`src/components/Toolbar.tsx`): new dock button "Effetto emoji" →
  `add(newEmojiFxLayer(defaultTargetId))`, where `defaultTargetId` is the
  currently-selected image layer, else the topmost image layer, else `null`.
- **Inspector** (`src/components/Inspector.tsx`): dispatch `emojifx` →
  `<EmojiFxProps>`. Panel controls:
  - **Immagine** — target select (dropdown of image layers by name; "nessuna" = orphan).
  - **Motivo** — pattern select (Anello / Sparso / Esplosione).
  - **Emoji** — multi-select glyph set + preset quick-fill buttons (Coriandoli / Fuochi / Scintille / Cuori). Multi-select can be a simple text input of glyphs plus preset buttons (lazy) — a chip picker is a later upgrade.
  - **Sliders** — Numero (count), Dimensione (size), Varianza (sizeJitter),
    Raggio (radius), Inclinazione (tilt), Profondità (depth), Rotazione (spin).
    `tilt`/`depth` hidden or disabled for patterns where they do not apply
    (`tilt` is ring-only; `depth` applies to all).
  - **Rimescola** — button that rerolls `seed`.

## 4. Persistence & migration — `src/lib/storage.ts`, `migrateDoc`

`emojifx` layers are plain JSON (glyphs are strings) — they serialize to
IndexedDB and JSON export/import with no special handling. No IndexedDB `VERSION`
bump is required (the store holds an opaque `ThumbDoc`; no schema-shaped
migration needed for an additive layer type). `migrateDoc` needs no `emojifx`
branch (older docs simply have none). Confirm during implementation that no
persistence code enumerates a closed set of layer types that would reject a new
one.

## 5. Testing — `src/state.test.ts`

Extend the existing test file with `layoutEmojiFx` checks (ponytail: one runnable
check for the non-trivial geometry):
- Determinism: same `(layer, target)` → identical `PlacedEmoji[]` across calls.
- Count: returns exactly `layer.count` placements.
- ring straddle: with a ring pattern, both `front === true` and `front === false`
  placements exist (the effect actually straddles).
- ring geometry: placements lie within `radius` (x) / `radius·tilt` (y) of center
  (plus jitter tolerance).

`bun run check` (tsc) must pass — the only gate.

## Scope cuts (deliberate — ponytail)

- **No animation.** Static spatial 3D only; export freezes a frame regardless.
  Add gentle float/spin animation later if desired.
- **Bind to images only** (not arbitrary layers) — matches the request.
- **3 patterns** (ring, scatter, burst) cover confetti/fireworks/sparkles + the
  hero orbit. More patterns are pure data — add on demand.
- **Glyph set as text input + presets**, not a full emoji chip picker — upgrade
  when it chafes.
