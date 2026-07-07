# Emoji Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `emojifx` layer type — a tunable field of emojis (confetti / fireworks / sparkles / 3D orbit) that wraps a target image, straddling it in z-order so some emojis sit behind the image and some in front.

**Architecture:** A bound layer references a target image id. Its arrangement is produced by one pure, seeded function `layoutEmojiFx()`. `ThumbCanvas` splits the arrangement into a behind-half and a front-half and splices them around the target image's DOM node — preserving the codebase's array-order == paint-order invariant (no `z-index` introduced).

**Tech Stack:** React 19 + TypeScript, Vite, Tailwind v4, `bun test` (bun's built-in test runner). No new dependencies.

## Global Constraints

- **UI strings are Italian** — every user-facing label/tooltip in Italian.
- **`bun run check` (tsc --noEmit) must pass** — the only gate; run at the end of every task.
- **Coordinates are always 1280×720 canvas space** (`CANVAS_W`/`CANVAS_H`), never screen pixels.
- **No new dependencies** — compose existing primitives.
- **Determinism** — the emoji arrangement must be stable across re-render, undo/redo, save/reload, and PNG export (seeded PRNG, no `Math.random` at render time).
- **Use the `newXxxLayer()` factory pattern** — never hand-build layer objects.
- Mark deliberate simplifications with `// ponytail:` comments.

---

### Task 1: Data model, seeded PRNG, and layout function

**Files:**
- Modify: `src/state.ts` (add `LayerType` member, `EmojiFxLayer` type, `Layer`/`LayerPatch` unions, `mulberry32`, `layoutEmojiFx`, `PlacedEmoji`, `EMOJIFX_PRESETS`, `newEmojiFxLayer`)
- Modify: `src/components/LayerList.tsx:8-15` (add `emojifx` to `TYPE_ICON` — required to keep `Record<LayerType, ReactNode>` total, else tsc fails)
- Test: `src/state.test.ts`

**Interfaces:**
- Produces:
  - `type EmojiFxLayer` (fields listed below)
  - `newEmojiFxLayer(targetId?: string | null): EmojiFxLayer`
  - `type PlacedEmoji = { glyph: string; x: number; y: number; size: number; rotation: number; opacity: number; front: boolean }`
  - `layoutEmojiFx(layer: EmojiFxLayer, center: { cx: number; cy: number }): PlacedEmoji[]`
  - `EMOJIFX_PRESETS: { label: string; glyphs: string[] }[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/state.test.ts`:

```ts
import {
  newEmojiFxLayer,
  layoutEmojiFx,
} from "./state";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/state.test.ts`
Expected: FAIL — `newEmojiFxLayer`/`layoutEmojiFx` not exported.

- [ ] **Step 3: Add the type to the `LayerType` union and layer unions**

In `src/state.ts`, change the `LayerType` line (currently line ~122):

```ts
export type LayerType = "text" | "image" | "emoji" | "shape" | "effect" | "draw" | "emojifx";
```

Add the layer type after `EmojiLayer` (after its closing `};`, ~line 199):

```ts
/** A field of emojis (confetti / fireworks / sparkles / 3D orbit) wrapping a target image.
 *  Bound: it centers on `targetId`'s bbox and is rendered straddling that image (some
 *  emojis behind, some in front). `x`/`y` are only used for the orphan fallback. */
export type EmojiFxLayer = LayerBase & {
  type: "emojifx";
  targetId: string | null; // image layer this wraps; null / missing = centered orphan fallback
  pattern: "ring" | "scatter" | "burst";
  glyphs: string[]; // multi-select set, distributed round-robin over `count`
  count: number; // number of emoji instances
  size: number; // base emoji px (1280×720 space); depth-scaled per emoji
  sizeJitter: number; // 0–100 random size variance
  radius: number; // ellipse radiusX (ring) / spread radius (scatter, burst), canvas units
  tilt: number; // 0–1: radiusY = radius * tilt (flattens the ring into an orbit). ring only.
  depth: number; // 0–100: front↔back scale & opacity contrast (the "3D" look)
  spin: number; // 0–100 random per-emoji rotation amount
  seed: number; // seeds the PRNG → arrangement stable across render/undo/save/export
};
```

Add `EmojiFxLayer` to the `Layer` union (line ~249) and `Partial<EmojiFxLayer>` to the `LayerPatch` union (line ~252-258):

```ts
export type Layer = TextLayer | ImageLayer | EmojiLayer | ShapeLayer | EffectLayer | DrawLayer | EmojiFxLayer;

export type LayerPatch =
  | Partial<TextLayer>
  | Partial<ImageLayer>
  | Partial<EmojiLayer>
  | Partial<ShapeLayer>
  | Partial<EffectLayer>
  | Partial<DrawLayer>
  | Partial<EmojiFxLayer>;
```

- [ ] **Step 4: Add the PRNG, layout function, presets, and factory**

In `src/state.ts`, add near the other factories (after `newEmojiLayer`, ~line 484):

```ts
/** Deterministic PRNG (mulberry32). Same seed → same stream — used so an emoji field's
 *  arrangement is identical across renders, undo/redo, save/reload, and PNG export. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PlacedEmoji = { glyph: string; x: number; y: number; size: number; rotation: number; opacity: number; front: boolean };

/** Emoji quick-fill sets for the inspector. */
export const EMOJIFX_PRESETS: { label: string; glyphs: string[] }[] = [
  { label: "Coriandoli", glyphs: ["🎉", "🎊", "✨"] },
  { label: "Fuochi", glyphs: ["🎆", "🎇", "💥", "✨"] },
  { label: "Scintille", glyphs: ["✨", "⭐", "💫", "🌟"] },
  { label: "Cuori", glyphs: ["❤️", "💕", "💖", "💗"] },
];

/** Deterministically place a field of emojis around `center` (canvas coords, glyph centres).
 *  ring: emojis on an ellipse, front = bottom half (nearest). scatter/burst: random cloud,
 *  each emoji independently in-front-or-behind (per design). All patterns apply size jitter,
 *  a per-emoji depth (drives size + opacity), and random rotation from the seeded stream. */
export function layoutEmojiFx(l: EmojiFxLayer, center: { cx: number; cy: number }): PlacedEmoji[] {
  const rng = mulberry32(l.seed);
  const glyphs = l.glyphs.length ? l.glyphs : ["✨"]; // ponytail: never render a blank field
  const depth = l.depth / 100;
  const out: PlacedEmoji[] = [];
  for (let i = 0; i < l.count; i++) {
    const glyph = glyphs[i % glyphs.length];
    let x: number, y: number, front: boolean, d: number;
    if (l.pattern === "ring") {
      const theta = (i / l.count) * Math.PI * 2 + (rng() - 0.5) * (Math.PI / l.count);
      x = center.cx + Math.cos(theta) * l.radius;
      y = center.cy + Math.sin(theta) * l.radius * l.tilt;
      d = Math.sin(theta); // -1 (top/back) .. 1 (bottom/front)
      front = d > 0;
    } else {
      const theta = rng() * Math.PI * 2;
      // burst radiates from the centre (√ for even area fill); scatter fills uniformly.
      const dist = (l.pattern === "burst" ? Math.sqrt(rng()) : rng()) * l.radius;
      x = center.cx + Math.cos(theta) * dist;
      y = center.cy + Math.sin(theta) * dist;
      d = rng() * 2 - 1;
      front = rng() < 0.5;
    }
    const jitter = 1 + (rng() * 2 - 1) * (l.sizeJitter / 100);
    const depthScale = 1 + d * depth * 0.6; // front bigger, back smaller
    const size = Math.max(8, l.size * jitter * depthScale);
    const opacity = Math.max(0.15, 1 - (1 - (d + 1) / 2) * depth * 0.7); // back fades
    const rotation = (rng() * 2 - 1) * l.spin * 1.8; // deg, ~±180 at spin=100
    out.push({ glyph, x, y, size, rotation, opacity, front });
  }
  return out;
}

export function newEmojiFxLayer(targetId: string | null = null): EmojiFxLayer {
  return {
    id: uid(),
    type: "emojifx",
    name: "Effetto emoji",
    x: 460,
    y: 260,
    rotation: 0,
    visible: true,
    targetId,
    pattern: "ring",
    glyphs: ["🎉", "🎊", "✨"],
    count: 18,
    size: 84,
    sizeJitter: 30,
    radius: 320,
    tilt: 0.45,
    depth: 55,
    spin: 40,
    seed: Math.floor(Math.random() * 1e9),
  };
}
```

- [ ] **Step 5: Add the `emojifx` icon to LayerList (keeps tsc green)**

In `src/components/LayerList.tsx`, add `PartyPopper` to the lucide import (line 2) and a `TYPE_ICON` entry (line 8-15):

```ts
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Image as ImageIcon, Link2, PartyPopper, Pencil, Smile, Sparkles, Square, Trash2, Type } from "lucide-react";
```

```ts
const TYPE_ICON: Record<LayerType, ReactNode> = {
  text: <Type className="size-3.5" />,
  image: <ImageIcon className="size-3.5" />,
  emoji: <Smile className="size-3.5" />,
  shape: <Square className="size-3.5" />,
  effect: <Sparkles className="size-3.5" />,
  draw: <Pencil className="size-3.5" />,
  emojifx: <PartyPopper className="size-3.5" />,
};
```

- [ ] **Step 6: Run tests to verify they pass, and typecheck**

Run: `bun test src/state.test.ts`
Expected: PASS (all new tests green).

Run: `bun run check`
Expected: no output (tsc passes).

- [ ] **Step 7: Commit**

```bash
git add src/state.ts src/state.test.ts src/components/LayerList.tsx
git commit -m "feat(state): emojifx layer type, seeded layout, presets"
```

---

### Task 2: Render the effect straddling its target image

**Files:**
- Modify: `src/components/ThumbCanvas.tsx` (import types/layout; add `EmojiFxGroup`; measure target centers; splice groups around the target; render orphans; add `emojifx` case to `LayerContent`)

**Interfaces:**
- Consumes: `EmojiFxLayer`, `layoutEmojiFx`, `PlacedEmoji` from `src/state.ts` (Task 1).
- Produces: correct on-canvas + on-export rendering. No exported symbols other tasks depend on.

- [ ] **Step 1: Extend imports and add React hooks**

In `src/components/ThumbCanvas.tsx` line 1, add `useLayoutEffect` and `Fragment`:

```ts
import { Fragment, useLayoutEffect, useState, type CSSProperties, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
```

In the state import (line 2), add `layoutEmojiFx` and `type EmojiFxLayer`:

```ts
import { CANVAS_H, CANVAS_W, FONTS, FONT_WEIGHT, drawPad, layoutEmojiFx, newDrawLayer, resolveBgBorder, type Action, type DrawCap, type DrawLayer, type EmojiFxLayer, type ImageLayer, type Layer, type LayerPatch, type TextLayer, type ThumbDoc } from "../state";
```

- [ ] **Step 2: Add the `EmojiFxGroup` component**

Add near the other content components (e.g. after `LayerContent`, ~line 654):

```tsx
/** One rendered half (or all) of an emoji field. pointer-events:none so it never blocks
 *  selecting the image beneath. Plain emoji spans → captured 1:1 by html-to-image. */
function EmojiFxGroup({ fx, center, half }: { fx: EmojiFxLayer; center: { cx: number; cy: number }; half: "back" | "front" | "all" }) {
  const placed = layoutEmojiFx(fx, center);
  const items = half === "all" ? placed : placed.filter((p) => (half === "front" ? p.front : !p.front));
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {items.map((p, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: p.x,
            top: p.y,
            fontSize: p.size,
            lineHeight: 1,
            opacity: p.opacity,
            transform: `translate(-50%, -50%) rotate(${p.rotation}deg)`,
          }}
        >
          {p.glyph}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add a `case "emojifx"` to `LayerContent`**

In `LayerContent` (the `switch (layer.type)` at ~line 613), add before the closing brace:

```tsx
    case "emojifx":
      return null; // rendered by the straddle splice in the layer map, never as a normal box
```

- [ ] **Step 4: Measure target image centres**

Inside the `ThumbCanvas` component body, after the `marquee` state (~line 133), add:

```tsx
  // Measured bbox centres of image layers targeted by an emoji field (canvas units).
  // Effects centre on these; on the first frame (empty) render falls back to layer x/y + est.
  const [centers, setCenters] = useState<Record<string, { cx: number; cy: number }>>({});
  useLayoutEffect(() => {
    const next: Record<string, { cx: number; cy: number }> = {};
    for (const l of doc.layers) {
      if (l.type !== "image") continue;
      const el = canvasRef.current?.querySelector<HTMLElement>(`[data-layer-id="${l.id}"]`);
      if (el) next[l.id] = { cx: l.x + el.offsetWidth / 2, cy: l.y + el.offsetHeight / 2 };
    }
    setCenters(next);
  }, [doc.layers, scale]);
```

- [ ] **Step 5: Build the target→effects map and splice in the render**

Just before `return (` in `ThumbCanvas` (~line 265), add:

```tsx
  // Visible emoji fields grouped by the image they wrap.
  const fxByTarget = new Map<string, EmojiFxLayer[]>();
  const orphanFx: EmojiFxLayer[] = [];
  for (const l of doc.layers) {
    if (l.type !== "emojifx" || !l.visible) continue;
    const target = l.targetId ? doc.layers.find((t) => t.id === l.targetId) : null;
    if (target && target.type === "image" && target.visible) {
      const arr = fxByTarget.get(target.id) ?? [];
      arr.push(l);
      fxByTarget.set(target.id, arr);
    } else {
      orphanFx.push(l); // ponytail: no live target → centred fallback, no straddle
    }
  }
  const fallbackCenter = (l: ImageLayer) => ({ cx: l.x + (BASE_IMG_W * l.scale) / 2, cy: l.y + BASE_IMG_W * l.scale * 0.6 });
```

Then in the existing `doc.layers.map((layer) => { ... })` (starts ~line 301), add near the top of the callback, right after the `if (!layer.visible) return null;` guard:

```tsx
        if (layer.type === "emojifx") return null; // rendered around its target below / as orphan
```

And change the callback's `return (...)` so that, for an image with effects, the effect halves splice around it. Wrap the existing `<div key={layer.id} ...> ... </div>` node: capture it in a `const node = ( ... );`, then replace the `return node;` with:

```tsx
        const fxs = layer.type === "image" ? fxByTarget.get(layer.id) ?? [] : [];
        if (fxs.length === 0) return node;
        const center = centers[layer.id] ?? fallbackCenter(layer as ImageLayer);
        return (
          <Fragment key={layer.id}>
            {fxs.map((fx) => <EmojiFxGroup key={`${fx.id}-b`} fx={fx} center={center} half="back" />)}
            {node}
            {fxs.map((fx) => <EmojiFxGroup key={`${fx.id}-f`} fx={fx} center={center} half="front" />)}
          </Fragment>
        );
```

(Give the captured `node` the same `key={layer.id}` it already has — harmless inside the Fragment. The `map` callback returns either `node` directly or the `Fragment`.)

- [ ] **Step 6: Render orphan effects (target missing/hidden)**

After the closing `</...>` of the `doc.layers.map(...)` block and before `<GlobalGrade .../>` (~line 342), add:

```tsx
      {orphanFx.map((fx) => (
        <EmojiFxGroup key={fx.id} fx={fx} center={{ cx: CANVAS_W / 2, cy: CANVAS_H / 2 }} half="all" />
      ))}
```

- [ ] **Step 7: Typecheck**

Run: `bun run check`
Expected: no output (tsc passes).

- [ ] **Step 8: Manual verification**

Run: `bun run dev`, open http://localhost:5174. With the default template (which has an image), open the browser console and temporarily seed an effect, OR proceed to Task 4 to add the dock button first if easier. Minimum check now: the app still renders every existing layer correctly and `bun run check` passes. (Full visual check happens after Task 4 wires the add button.)

- [ ] **Step 9: Commit**

```bash
git add src/components/ThumbCanvas.tsx
git commit -m "feat(canvas): render emojifx straddling its target image"
```

---

### Task 3: Inspector panel for tuning the effect

**Files:**
- Modify: `src/components/Inspector.tsx` (import factory/type/presets; add dispatch line; add `EmojiFxProps` panel)

**Interfaces:**
- Consumes: `EmojiFxLayer`, `newEmojiFxLayer`, `EMOJIFX_PRESETS` from `src/state.ts`; `Setter`, `SliderRow`, `SelectField`, `ColorRow`, `Field`, `Hint` primitives already used in the file; `Input`, `Button` (already imported).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Extend imports**

In `src/components/Inspector.tsx` state import block (~line 14), add `newEmojiFxLayer`, `EMOJIFX_PRESETS`, and `type EmojiFxLayer`:

```ts
  newEmojiFxLayer,
  EMOJIFX_PRESETS,
```
```ts
  type EmojiFxLayer,
```

(Add each on its own line within the existing multiline import, matching the alphabetically-loose ordering already present. `newEmojiFxLayer` near the other `newXxxLayer`; `EMOJIFX_PRESETS` near `defaultEffect`; `type EmojiFxLayer` near `type EmojiLayer`.)

- [ ] **Step 2: Add the dispatch line**

In `Inspector` (the per-type conditionals ~line 130-135), add after the `emoji` line — and pass `layers` so the panel can list target images:

```tsx
        {selected.type === "emojifx" && <EmojiFxProps layer={selected} set={set} layers={layers} />}
```

- [ ] **Step 3: Add the `EmojiFxProps` component**

Add near `EmojiProps` (~line 389):

```tsx
const EMOJIFX_PATTERN_OPTIONS: { value: EmojiFxLayer["pattern"]; label: string }[] = [
  { value: "ring", label: "Anello 3D" },
  { value: "scatter", label: "Sparso" },
  { value: "burst", label: "Esplosione" },
];

function EmojiFxProps({ layer, set, layers }: { layer: EmojiFxLayer; set: Setter; layers: Layer[] }) {
  const D = newEmojiFxLayer();
  const imageOptions = [
    { value: "", label: "Nessuna (al centro)" },
    ...layers.filter((l) => l.type === "image").map((l) => ({ value: l.id, label: l.name })),
  ];
  return (
    <>
      <SelectField
        label="Immagine"
        value={layer.targetId ?? ""}
        options={imageOptions}
        onChange={(id) => set({ targetId: id === "" ? null : id })}
      />
      <SelectField label="Motivo" value={layer.pattern} options={EMOJIFX_PATTERN_OPTIONS} onChange={(pattern) => set({ pattern })} />
      <Field label="Emoji">
        {/* ponytail: space-separated glyphs — avoids grapheme-cluster splitting; presets below fill it. */}
        <Input value={layer.glyphs.join(" ")} onChange={(e) => set({ glyphs: e.target.value.split(/\s+/).filter(Boolean) })} />
      </Field>
      <div className="flex flex-wrap gap-1">
        {EMOJIFX_PRESETS.map((p) => (
          <Button key={p.label} variant="outline" size="sm" onClick={() => set({ glyphs: p.glyphs })}>
            {p.label}
          </Button>
        ))}
      </div>
      <SliderRow label="Numero" min={3} max={80} value={layer.count} defaultValue={D.count} onChange={(count) => set({ count })} />
      <SliderRow label="Dimensione" min={20} max={220} value={layer.size} defaultValue={D.size} onChange={(size) => set({ size })} />
      <SliderRow label="Varianza" min={0} max={100} value={layer.sizeJitter} defaultValue={D.sizeJitter} display={`${layer.sizeJitter}%`} onChange={(sizeJitter) => set({ sizeJitter })} />
      <SliderRow label="Raggio" min={80} max={640} value={layer.radius} defaultValue={D.radius} onChange={(radius) => set({ radius })} />
      {layer.pattern === "ring" && (
        <SliderRow label="Inclinazione" min={5} max={100} value={Math.round(layer.tilt * 100)} defaultValue={Math.round(D.tilt * 100)} display={`${Math.round(layer.tilt * 100)}%`} onChange={(v) => set({ tilt: v / 100 })} />
      )}
      <SliderRow label="Profondità" min={0} max={100} value={layer.depth} defaultValue={D.depth} display={`${layer.depth}%`} onChange={(depth) => set({ depth })} />
      <SliderRow label="Rotazione casuale" min={0} max={100} value={layer.spin} defaultValue={D.spin} display={`${layer.spin}%`} onChange={(spin) => set({ spin })} />
      <Button variant="outline" size="sm" onClick={() => set({ seed: Math.floor(Math.random() * 1e9) })}>
        Rimescola
      </Button>
    </>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run check`
Expected: no output. (If `Button` is not yet imported in Inspector.tsx, add `import { Button } from "./ui/button";` — verify against the file's existing imports first; `Input` is already imported.)

- [ ] **Step 5: Commit**

```bash
git add src/components/Inspector.tsx
git commit -m "feat(inspector): emoji effect tuning panel"
```

---

### Task 4: Toolbar dock button + default target wiring

**Files:**
- Modify: `src/components/Toolbar.tsx` (accept `layers`; add dock button; pick default target)
- Modify: `src/App.tsx:346` (pass `layers={doc.layers}` to `<Toolbar>`)

**Interfaces:**
- Consumes: `newEmojiFxLayer` from `src/state.ts`; `Layer` type.
- Produces: user-facing "Effetto emoji" creation button.

- [ ] **Step 1: Extend Toolbar imports and props**

In `src/components/Toolbar.tsx`, add `PartyPopper` to the lucide import (line 2):

```ts
import { Camera, ImagePlus, Minus, PartyPopper, Pencil, Smile, Sparkles, Square, Type } from "lucide-react";
```

Add `newEmojiFxLayer` to the state import (line 4-13):

```ts
  newEmojiFxLayer,
```

Add `layers` to the component props (line 22):

```tsx
export function Toolbar({ dispatch, layers, onError, drawMode, setDrawMode }: { dispatch: Dispatch<Action>; layers: Layer[]; onError: (msg: string) => void; drawMode: boolean; setDrawMode: (v: boolean) => void }) {
```

- [ ] **Step 2: Add the dock button**

In `Toolbar.tsx`, add after the "Effetto" button (~line 66):

```tsx
        <DockButton
          label="Effetto emoji"
          onClick={() => {
            // Default to the topmost image layer as the target; null = centred orphan.
            const target = [...layers].reverse().find((l) => l.type === "image")?.id ?? null;
            add(newEmojiFxLayer(target));
          }}
        >
          <PartyPopper />
        </DockButton>
```

- [ ] **Step 3: Pass `layers` from App**

In `src/App.tsx` line 346, change:

```tsx
              <Toolbar dispatch={dispatch} layers={doc.layers} onError={setMessage} drawMode={drawMode} setDrawMode={setDrawMode} />
```

- [ ] **Step 4: Typecheck**

Run: `bun run check`
Expected: no output.

- [ ] **Step 5: Manual end-to-end verification**

Run: `bun run dev`, open http://localhost:5174.
1. The default template has an image. Click the dock "Effetto emoji" button.
2. Expect a 🎉🎊✨ ring wrapping the image — some emojis in front, some behind it.
3. Select the effect in the layer list → the inspector shows the tuning panel.
4. Change Motivo to "Sparso" and "Esplosione"; adjust Numero / Raggio / Profondità / Inclinazione; click a preset (Fuochi) and Rimescola. Confirm live updates and that one Cmd+Z reverts a full slider drag (gesture coalescing).
5. Move the target image — the effect re-centers on it (after the layout effect measures; may lag one frame).
6. Add a second effect on the same image (e.g. Scintille) — both straddle it.
7. Export the PNG (existing export button) and confirm emojis appear correctly, front and behind, in the downloaded image.

- [ ] **Step 6: Commit**

```bash
git add src/components/Toolbar.tsx src/App.tsx
git commit -m "feat(toolbar): add emoji effect creation button"
```

---

## Self-Review

**Spec coverage:**
- Data model (`emojifx`, all tunables, seed) → Task 1 ✓
- Seeded PRNG determinism → Task 1 (mulberry32 + tests) ✓
- `layoutEmojiFx` pure function, 3 patterns, random front/behind for scatter+burst, ring `sinθ` → Task 1 ✓
- Straddle rendering, pointer-events:none, orphan fallback, no z-index → Task 2 ✓
- `LayerContent` case + LayerList icon (tsc-total unions) → Task 1 (icon) + Task 2 (case) ✓
- Inspector panel with target dropdown, pattern, glyph multi-select + presets, sliders, reshuffle → Task 3 ✓
- Toolbar add button + default target → Task 4 ✓
- Persistence: additive plain-JSON layer, no VERSION bump, no `migrateDoc` branch → confirmed no code change needed; Task 4 Step 5 exercises save via autosave/export. ✓
- No animation / images-only / 3 patterns cuts → honored ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `EmojiFxLayer`, `layoutEmojiFx(layer, center)`, `PlacedEmoji`, `newEmojiFxLayer(targetId?)`, `EMOJIFX_PRESETS`, `fxByTarget`, `centers`, `EmojiFxGroup(half)` used identically across tasks. `set`/`Setter` matches Inspector's existing helper. `SelectField<T extends string>` options use string values (`""` for null target) — matches its generic. ✓
