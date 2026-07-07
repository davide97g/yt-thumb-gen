// Layer-based document model for the thumbnail editor.
//
// A ThumbDoc is a background plus a flat, ordered list of layers (array order =
// paint order, back → front). Every layer is freely positioned (x, y in 1280×720
// space) and individually selectable/draggable. Presets are no longer a mode you
// live in — they're templates (see presets.ts) that seed a fresh layer list.

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

export type FontKey =
  | "archivo"
  | "inter"
  | "georgia"
  | "mono"
  | "bebas"
  | "anton"
  | "oswald"
  | "leagueGothic"
  | "leagueSpartan"
  | "montserrat"
  | "poppins"
  | "robotoCondensed"
  | "luckiestGuy"
  | "bangers"
  | "sfpro"
  | "helvetica"
  | "segoe"
  | "crimsonPro"
  | "geistMono"
  | "libreBaskerville"
  | "lobster"
  | "spaceGrotesk"
  | "anthropicSans";

/** Maps a font key to its CSS font-family stack. */
export const FONTS: Record<FontKey, string> = {
  archivo: "'Archivo Black', sans-serif",
  inter: "'Inter', sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, monospace",
  bebas: "'Bebas Neue', sans-serif",
  anton: "'Anton', sans-serif",
  oswald: "'Oswald', sans-serif",
  leagueGothic: "'League Gothic', sans-serif",
  leagueSpartan: "'League Spartan', sans-serif",
  montserrat: "'Montserrat', sans-serif",
  poppins: "'Poppins', sans-serif",
  robotoCondensed: "'Roboto Condensed', sans-serif",
  luckiestGuy: "'Luckiest Guy', cursive",
  bangers: "'Bangers', cursive",
  // System display faces — not bundled (proprietary); render natively per OS.
  sfpro: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
  helvetica: "'Helvetica Neue', 'Helvetica Now Display', Helvetica, Arial, sans-serif",
  segoe: "'Segoe UI Variable Display', 'Segoe UI Variable', 'Segoe UI', sans-serif",
  crimsonPro: "'Crimson Pro', Georgia, serif",
  geistMono: "'Geist Mono', ui-monospace, monospace",
  libreBaskerville: "'Libre Baskerville', Georgia, serif",
  lobster: "'Lobster', cursive",
  spaceGrotesk: "'Space Grotesk', sans-serif",
  anthropicSans: "'Anthropic Sans', sans-serif",
};

/**
 * Render weight per font. Most thumbnail faces want maximum weight (900), but the
 * single-weight display fonts (Bebas Neue, Anton, League Gothic) only ship 400 and
 * faux-bolding them looks muddy, so they render at their natural weight. Oswald
 * renders Bold (700), as requested. Mono stays at 500.
 */
export const FONT_WEIGHT: Record<FontKey, number> = {
  archivo: 900,
  inter: 900,
  georgia: 900,
  mono: 500,
  bebas: 400,
  anton: 400,
  oswald: 700,
  leagueGothic: 400,
  leagueSpartan: 800,
  montserrat: 800,
  poppins: 800,
  robotoCondensed: 700,
  luckiestGuy: 400,
  bangers: 400,
  sfpro: 900,
  helvetica: 900,
  segoe: 900,
  crimsonPro: 700,
  geistMono: 500,
  libreBaskerville: 700,
  lobster: 400,
  spaceGrotesk: 700,
  anthropicSans: 800,
};

export const FONT_LABELS: Record<FontKey, string> = {
  archivo: "Archivo Black",
  inter: "Inter",
  georgia: "Georgia (serif)",
  mono: "Monospace",
  bebas: "Bebas Neue",
  anton: "Anton",
  oswald: "Oswald (Bold)",
  leagueGothic: "League Gothic",
  leagueSpartan: "League Spartan",
  montserrat: "Montserrat (ExtraBold)",
  poppins: "Poppins (ExtraBold)",
  robotoCondensed: "Roboto Condensed (Bold)",
  luckiestGuy: "Luckiest Guy",
  bangers: "Bangers",
  sfpro: "SF Pro Display",
  helvetica: "Helvetica Neue",
  segoe: "Segoe UI Variable",
  crimsonPro: "Crimson Pro (serif)",
  geistMono: "Geist Mono",
  libreBaskerville: "Libre Baskerville (serif)",
  lobster: "Lobster (script)",
  spaceGrotesk: "Space Grotesk",
  anthropicSans: "Anthropic Sans",
};

export type LayerType = "text" | "image" | "emoji" | "shape" | "effect" | "draw" | "emojifx";

/** Fields shared by every layer. */
type LayerBase = {
  id: string;
  type: LayerType;
  name: string; // shown in the layer list
  x: number; // top-left, 1280×720 space
  y: number;
  rotation: number; // degrees
  visible: boolean;
  groupId?: string; // shared across grouped layers; absent = ungrouped. ponytail: logical-only, no z-order reflow, no nesting.
};

/**
 * A pure-CSS text effect (React Bits-inspired). All variants render via background-clip
 * or text-shadow so they're captured 1:1 by html-to-image on export. See ThumbCanvas.
 */
export type TextFx =
  | { kind: "none" }
  // React Bits "Gradient Text": animated multi-colour gradient clipped to glyphs.
  | { kind: "gradient"; colors: [string, string, string]; speed: number; direction: "horizontal" | "vertical" | "diagonal" }
  // React Bits "Shiny Text": a sheen sweeping across the text.
  | { kind: "shiny"; color: string; shineColor: string; spread: number; speed: number; direction: "left" | "right" }
  // React Bits "Glitch Text": RGB-split duplicates jittering via clip-path (uses the .rb-glitch CSS class).
  | { kind: "glitch"; speed: number; color1: string; color2: string; enableShadows: boolean };

/** A run of text. Today's title lines, badge, and episode pill are all Text layers. */
export type TextLayer = LayerBase & {
  type: "text";
  text: string; // multi-line via \n
  font: FontKey;
  size: number; // px in 1280×720 space
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  opacity: number; // 0–100
  stroke: boolean; // outline toggle
  strokeWidth: number; // outline thickness px (1280×720 space)
  strokeColor: string;
  shadow: boolean; // hard drop shadow
  /** Optional background pill behind the text — turns a Text layer into a badge/pill. */
  bg: { enabled: boolean; color: string; padX: number; padY: number; radius: number };
  fx?: TextFx; // optional special effect; absent/"none" = plain fill
};

/** An uploaded/captured photo, or a built-in Claude brand mark (logo/wordmark). */
export type ImageLayer = LayerBase & {
  type: "image";
  src: string | null; // dataURL; null while empty or when `brand` is set
  origSrc: string | null; // pre-background-removal original, for "Ripristina"
  brand: "logo" | "wordmark" | null; // built-in Claude SVG mark; overrides src when set
  brandColor: string; // fill colour for the brand mark
  scale: number; // 1 = base width (see BASE_IMG_W / brand bases in ThumbCanvas)
  opacity: number; // 0–100
  flip: boolean;
  radius: number; // corner radius px
  ring: boolean; // solid border
  ringColor: string;
  glow: boolean; // glow tracing the cut-out alpha edge
  glowStyle: "glow" | "line"; // soft glow vs. solid sticker outline
  glowColor: string;
  glowSize: number;
  // Light/colour tweaks via CSS filter, in % (100 = neutral). Optional → old docs read as 100.
  brightness?: number;
  contrast?: number;
  saturation?: number;
  // Non-destructive crop. `src` is never altered — these just hide parts of it.
  crop?: { l: number; t: number; r: number; b: number }; // edge insets, fractions 0–1 of the full image; absent = uncropped
  mask?: { points: { x: number; y: number }[] }; // lasso polygon in full-image fractions; absent = no lasso. `crop` holds its bbox.
};

/** A single emoji / glyph. */
export type EmojiLayer = LayerBase & {
  type: "emoji";
  glyph: string;
  size: number;
};

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

/** A rectangle, pill, or the fake YouTube "watched" progress bar. */
export type ShapeLayer = LayerBase & {
  type: "shape";
  kind: "rect" | "pill" | "bar";
  fill: string;
  w: number;
  h: number;
  radius: number; // corner radius (ignored for "pill" — auto — and "bar")
  pct: number; // "bar" only: watched fraction 0–100
  trackColor: string; // "bar" only: unwatched track colour
};

/** A React Bits background effect dropped onto the canvas as a movable, resizable box. */
export type EffectLayer = LayerBase & {
  type: "effect";
  w: number; // box width in 1280×720 space
  h: number; // box height
  radius: number; // corner radius
  effect: BgEffect; // preset + params — same shape as a Background effect
};

export type DrawCap = "none" | "arrow" | "dot" | "tee";

/** A freehand stroke. Points are bbox-relative (0..rawW, 0..rawH) in 1280×720 units.
 *  The rendered box pads the raw bbox by an amount derived from thickness + caps so the
 *  selection frame always hugs the *visible* ink (stroke + arrowheads), and `scale`
 *  resizes the whole thing like an image. x/y is the padded box's top-left. */
export type DrawLayer = LayerBase & {
  type: "draw";
  points: { x: number; y: number }[]; // bbox-relative, 1280×720 units
  rawW: number; // raw stroke bbox width (no padding) — constant
  rawH: number; // raw stroke bbox height — constant
  scale: number; // resize factor (1 = drawn size)
  color: string;
  thickness: number; // stroke width in 1280×720 units
  lineStyle: "solid" | "dashed" | "dotted";
  smoothing: number; // 0–100: how aggressively the captured polyline is simplified before splining
  startCap: DrawCap;
  endCap: DrawCap;
};

/** Symmetric padding (1280-space units) around a stroke's raw bbox so its caps/arrowheads
 *  fit inside the rendered box. Caps flare ~2× the stroke width past the endpoint. */
export function drawPad(thickness: number, startCap: DrawCap, endCap: DrawCap): number {
  const capped = startCap !== "none" || endCap !== "none";
  return thickness * (capped ? 2.5 : 0.7);
}

export type Layer = TextLayer | ImageLayer | EmojiLayer | ShapeLayer | EffectLayer | DrawLayer | EmojiFxLayer;

/** A partial patch for any single layer type (used by inspectors → updateLayer). */
export type LayerPatch =
  | Partial<TextLayer>
  | Partial<ImageLayer>
  | Partial<EmojiLayer>
  | Partial<ShapeLayer>
  | Partial<EffectLayer>
  | Partial<DrawLayer>
  | Partial<EmojiFxLayer>;

/**
 * Animated background presets ported from React Bits. `grainient`/`aurora` are WebGL
 * shaders (see EffectBackground.tsx); `mesh`/`dots` are pure CSS. Rendered only when
 * Background.mode === "effect". Field names mirror the React Bits component props /
 * Background Studio knobs 1:1.
 */
export type BgEffect =
  | {
      preset: "grainient";
      color1: string;
      color2: string;
      color3: string;
      timeSpeed: number;
      colorBalance: number;
      warpStrength: number;
      warpFrequency: number;
      warpSpeed: number;
      warpAmplitude: number;
      blendAngle: number;
      blendSoftness: number;
      rotationAmount: number;
      noiseScale: number;
      grainAmount: number;
      grainScale: number;
      grainAnimated: boolean;
      contrast: number;
      gamma: number;
      saturation: number;
      centerX: number;
      centerY: number;
      zoom: number;
    }
  | { preset: "aurora"; color1: string; color2: string; color3: string; speed: number; blend: number; amplitude: number }
  | { preset: "mesh"; color1: string; color2: string; color3: string; bgColor: string; softness: number }
  | { preset: "dots"; dotColor: string; bgColor: string; size: number; gap: number };

export type Background = {
  mode: "gradient" | "solid" | "image" | "effect";
  from: string;
  to: string;
  image: string | null; // dataURL for a custom background image
  imageZoom?: number; // 100–200 zoom % for image mode (default 100 = cover)
  imageX?: number; // -25…25 horizontal nudge % for image mode (default 0)
  imageY?: number; // -25…25 vertical nudge % for image mode (default 0), to crop out e.g. a top status bar
  overlay: number; // 0–100 darkness of the scrim over the background
  effect?: BgEffect; // present when mode === "effect"
  // Global colour grade painted ON TOP of every layer, to make the whole composite cohesive. All optional.
  gradeTint?: string; // tint colour
  gradeAmount?: number; // 0–100 tint strength
  gradeBlend?: "soft-light" | "overlay" | "multiply" | "screen" | "color";
  gradeVignette?: number; // 0–100 darkened edges
  gradeGrain?: number; // 0–100 film grain
  /** Full-canvas frame border painted on top of every layer. All optional — absent = off. */
  border?: BgBorder;
};

export type BgBorderStyle = "solid" | "dashed" | "dotted" | "double";

export type BgBorder = {
  enabled: boolean;
  color: string;
  width: number; // px, thickness of the stroke
  radius: number; // px, corner roundness of the inner edge
  style: BgBorderStyle;
  inset: number; // px, gap between the canvas edge and the border box
  opacity: number; // 0–100
};

/** Fresh defaults for the full-canvas border — thick black frame with rounded inner corners. */
export function defaultBgBorder(): BgBorder {
  return { enabled: false, color: "#000000", width: 24, radius: 32, style: "solid", inset: 0, opacity: 100 };
}

/** Merge stored border with defaults so callers never need to null-check every field. */
export function resolveBgBorder(border?: BgBorder): BgBorder {
  return { ...defaultBgBorder(), ...border };
}

/** Fresh, sane defaults for an effect preset — the React Bits component defaults. */
export function defaultEffect(preset: BgEffect["preset"]): BgEffect {
  switch (preset) {
    case "grainient":
      return {
        preset,
        color1: "#ff9ffc",
        color2: "#5227ff",
        color3: "#b497cf",
        timeSpeed: 0.25,
        colorBalance: 0,
        warpStrength: 1,
        warpFrequency: 5,
        warpSpeed: 2,
        warpAmplitude: 50,
        blendAngle: 0,
        blendSoftness: 0.05,
        rotationAmount: 500,
        noiseScale: 2,
        grainAmount: 0.1,
        grainScale: 2,
        grainAnimated: false,
        contrast: 1.5,
        gamma: 1,
        saturation: 1,
        centerX: 0,
        centerY: 0,
        zoom: 0.9,
      };
    case "aurora":
      return { preset, color1: "#5227ff", color2: "#7cff67", color3: "#5227ff", speed: 1, blend: 0.5, amplitude: 1 };
    case "mesh":
      return { preset, color1: "#ff9ffc", color2: "#5227ff", color3: "#b497cf", bgColor: "#120f17", softness: 0.6 };
    case "dots":
      return { preset, dotColor: "#2a2342", bgColor: "#120f17", size: 2, gap: 26 };
  }
}

/** Fresh, sane defaults for a text effect kind — matching the React Bits component defaults. */
export function defaultFx(kind: TextFx["kind"]): TextFx {
  switch (kind) {
    case "none":
      return { kind };
    case "gradient":
      return { kind, colors: ["#5227ff", "#ff9ffc", "#b497cf"], speed: 8, direction: "horizontal" };
    case "shiny":
      return { kind, color: "#b5b5b5", shineColor: "#ffffff", spread: 120, speed: 2, direction: "left" };
    case "glitch":
      return { kind, speed: 1, color1: "#00ffff", color2: "#ff0000", enableShadows: true };
  }
}

export type ThumbDoc = {
  background: Background;
  layers: Layer[]; // back → front
};

export type AppState = { doc: ThumbDoc; selectedIds: string[] };

/** The layer that drives the single-layer Inspector — the last one selected. */
export const primaryId = (s: AppState): string | null => s.selectedIds[s.selectedIds.length - 1] ?? null;

// ── Layer factories ─────────────────────────────────────────────────────────

const uid = () => crypto.randomUUID();

export function newTextLayer(): TextLayer {
  return {
    id: uid(),
    type: "text",
    name: "Testo",
    x: 120,
    y: 120,
    rotation: 0,
    visible: true,
    text: "NUOVO TESTO",
    font: "archivo",
    size: 96,
    color: "#ffffff",
    align: "left",
    lineHeight: 1.02,
    opacity: 100,
    stroke: false,
    strokeWidth: 5,
    strokeColor: "#000000",
    shadow: false,
    bg: { enabled: false, color: "#ff0000", padX: 22, padY: 8, radius: 12 },
  };
}

export function newImageLayer(src: string | null = null): ImageLayer {
  return {
    id: uid(),
    type: "image",
    name: "Immagine",
    x: 820,
    y: 260,
    rotation: 0,
    visible: true,
    src,
    origSrc: null,
    brand: null,
    brandColor: "#D97757",
    scale: 1,
    opacity: 100,
    flip: false,
    radius: 0,
    ring: false,
    ringColor: "#ffd400",
    glow: false,
    glowStyle: "glow",
    glowColor: "#ffe600",
    glowSize: 18,
  };
}

export function newBrandLayer(brand: "logo" | "wordmark"): ImageLayer {
  return {
    ...newImageLayer(null),
    name: brand === "logo" ? "Logo Claude" : "Scritta Claude",
    brand,
    brandColor: brand === "logo" ? "#D97757" : "#ffffff",
    x: brand === "logo" ? 1120 : 800,
    y: brand === "logo" ? 36 : 600,
    scale: brand === "logo" ? 0.6 : 0.7,
  };
}

export function newEffectLayer(): EffectLayer {
  return {
    id: uid(),
    type: "effect",
    name: "Effetto",
    x: 360,
    y: 220,
    rotation: 0,
    visible: true,
    w: 560,
    h: 320,
    radius: 16,
    effect: defaultEffect("grainient"),
  };
}

export function newEmojiLayer(): EmojiLayer {
  return { id: uid(), type: "emoji", name: "Emoji", x: 760, y: 90, rotation: 0, visible: true, glyph: "🤯", size: 150 };
}

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

export function newShapeLayer(kind: ShapeLayer["kind"]): ShapeLayer {
  const base = { id: uid(), type: "shape" as const, rotation: 0, visible: true, radius: 16, pct: 72, trackColor: "rgba(255,255,255,.35)" };
  if (kind === "bar") return { ...base, name: "Barra progresso", kind, fill: "#ff0000", x: 0, y: CANVAS_H - 14, w: CANVAS_W, h: 14 };
  if (kind === "pill") return { ...base, name: "Pillola", kind, fill: "#e8633a", x: 120, y: 120, w: 280, h: 70, radius: 999 };
  return { ...base, name: "Rettangolo", kind, fill: "#e8633a", x: 120, y: 120, w: 320, h: 200 };
}

const DRAW_DEFAULTS = { color: "#ff3b3b", thickness: 8, lineStyle: "solid" as const, smoothing: 40, startCap: "none" as const, endCap: "arrow" as const };

/** Build a freehand layer from raw points captured in 1280×720 canvas space. */
export function newDrawLayer(points: { x: number; y: number }[]): DrawLayer {
  const pts = points.length ? points : [{ x: 0, y: 0 }, { x: 1, y: 1 }]; // guard: factory used for inspector defaults too
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  const pad = drawPad(DRAW_DEFAULTS.thickness, DRAW_DEFAULTS.startCap, DRAW_DEFAULTS.endCap);
  return {
    id: uid(),
    type: "draw",
    name: "Disegno",
    x: minX - pad, // padded box top-left = where the div sits
    y: minY - pad,
    rotation: 0,
    visible: true,
    points: pts.map((p) => ({ x: p.x - minX, y: p.y - minY })), // bbox-relative, 0-based
    rawW: maxX - minX,
    rawH: maxY - minY,
    scale: 1,
    ...DRAW_DEFAULTS,
  };
}

/** Upgrade a loaded doc in place: convert draw layers saved before the rawW/scale schema
 *  (they stored vw/vh/w/h with a 16px pad baked into points) to the current shape. */
export function migrateDoc(doc: ThumbDoc): ThumbDoc {
  const OLD_PAD = 16;
  const layers = doc.layers.map((l) => {
    if (l.type !== "draw" || "rawW" in l) return l;
    const old = l as unknown as { vw: number; vh: number; w: number; points: { x: number; y: number }[] } & DrawLayer;
    return {
      ...old,
      points: old.points.map((p) => ({ x: p.x - OLD_PAD, y: p.y - OLD_PAD })),
      rawW: old.vw - OLD_PAD * 2,
      rawH: old.vh - OLD_PAD * 2,
      scale: old.w / old.vw,
    } as DrawLayer;
  });
  return { ...doc, layers };
}

// ── Reducer ───────────────────────────────────────────────────────────────────

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

function mapLayer(doc: ThumbDoc, id: string, fn: (l: Layer) => Layer): ThumbDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? fn(l) : l)) };
}

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
      const { groupId: _drop, ...rest } = action.layer;
      const clone = { ...rest, id: uid(), x: action.layer.x + 24, y: action.layer.y + 24 } as Layer;
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

// ── Undo / redo ─────────────────────────────────────────────────────────────
//
// A history wrapper around `reducer`. Snapshots are whole AppState values; since
// `reducer` updates immutably, unchanged layers (incl. their big image dataURLs)
// are shared by reference across snapshots, so 20 entries cost ~deltas, not 20×.
//
// Continuous gestures (drag = a burst of `nudge`; slider/colour drag = a burst of
// `updateLayer`/`updateBackground` on the same keys) coalesce into ONE entry via a
// `tag`: while the incoming tag matches the last, we replace `present` instead of
// pushing. So one Cmd+Z undoes a whole drag, not one pixel.

export const HISTORY_LIMIT = 20;

export type History = { past: AppState[]; present: AppState; future: AppState[]; tag: string | null };

export type HistAction = Action | { type: "undo" } | { type: "redo" };

export const initHistory = (present: AppState): History => ({ past: [], present, future: [], tag: null });

/** Identifies a continuous edit gesture; null = discrete action (always its own entry). */
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

export function historyReducer(h: History, action: HistAction): History {
  if (action.type === "undo") {
    if (!h.past.length) return h;
    return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], tag: null };
  }
  if (action.type === "redo") {
    if (!h.future.length) return h;
    return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), tag: null };
  }

  const present = reducer(h.present, action);
  if (present === h.present) return h; // no-op (e.g. reorder at an edge)
  if (action.type === "loadDoc") return initHistory(present); // template/import = clean slate
  if (action.type === "select") return { ...h, present, tag: null }; // selection isn't undoable

  const tag = gestureTag(action);
  if (tag && tag === h.tag) return { ...h, present, future: [] }; // same gesture → coalesce
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present, future: [], tag };
}
