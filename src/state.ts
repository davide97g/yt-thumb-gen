// Layer-based document model for the thumbnail editor.
//
// A ThumbDoc is a background plus a flat, ordered list of layers (array order =
// paint order, back → front). Every layer is freely positioned (x, y in 1280×720
// space) and individually selectable/draggable. Presets are no longer a mode you
// live in — they're templates (see presets.ts) that seed a fresh layer list.

// Authoring space: templates and layer factories are written in 1280×720
// coordinates. The live canvas size comes from the doc's `format` instead
// (see FORMATS / canvasSize below).
export const CANVAS_W = 1280;
export const CANVAS_H = 720;

export type FormatKey = "youtube" | "shorts" | "ig-post" | "ig-reel" | "linkedin";

export type FormatSpec = {
  key: FormatKey;
  label: string; // select label
  platform: string; // header readout
  w: number;
  h: number;
  aspect: string;
  maxBytes?: number; // hard export size limit; only YouTube rejects oversized PNGs
};

export const FORMATS: Record<FormatKey, FormatSpec> = {
  youtube: { key: "youtube", label: "YouTube (16:9)", platform: "YouTube", w: 1280, h: 720, aspect: "16:9", maxBytes: 2 * 1024 * 1024 },
  shorts: { key: "shorts", label: "Shorts (9:16)", platform: "YouTube Shorts", w: 1080, h: 1920, aspect: "9:16" },
  "ig-post": { key: "ig-post", label: "Post IG (4:5)", platform: "Instagram", w: 1080, h: 1350, aspect: "4:5" },
  "ig-reel": { key: "ig-reel", label: "Reel IG (9:16)", platform: "Instagram Reels", w: 1080, h: 1920, aspect: "9:16" },
  linkedin: { key: "linkedin", label: "LinkedIn (4:5)", platform: "LinkedIn", w: 1080, h: 1350, aspect: "4:5" },
};

export const DEFAULT_FORMAT: FormatKey = "youtube";

export const canvasSize = (f: FormatKey) => ({ w: FORMATS[f].w, h: FORMATS[f].h });

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

/** Fields shared by every layer. `type` is deliberately absent: each concrete layer
 *  declares its own literal, which keeps the union discriminated all the way into the
 *  generated JSON Schema (a wide `type: LayerType` here would merge ambiguously). */
type LayerBase = {
  id: string;
  /** Shown in the layer list. */
  name: string;
  /** Left edge, in 1280×720 canvas space. */
  x: number;
  /** Top edge, in 1280×720 canvas space. */
  y: number;
  /** Rotation in degrees. */
  rotation: number;
  visible: boolean;
  /** Shared across grouped layers; absent = ungrouped. ponytail: logical-only, no z-order reflow, no nesting. */
  groupId?: string;
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

/** Size limits, shared by the Inspector sliders and the canvas resize handles so the two never
 *  disagree. Intentionally near-unbounded (a layer may dwarf the canvas); the sliders use a log
 *  curve so the wide range stays usable, and the per-slider reset button restores the default. */
export const SIZE_LIMITS = {
  textSize: [4, 4000],
  emojiSize: [8, 4000],
  emojiFxSize: [8, 2000],
  imageScale: [0.02, 50],
  drawScale: [0.02, 50],
  boxW: [4, 20000], // shape + effect box width
  boxH: [4, 20000],
} as const satisfies Record<string, readonly [number, number]>;

/** A run of text. Today's title lines, badge, and episode pill are all Text layers. */
export type TextLayer = LayerBase & {
  type: "text";
  /** The copy. Multi-line via \n. */
  text: string;
  font: FontKey;
  /** Font size in px, in 1280×720 canvas space. Typical title: 90–140. */
  size: number;
  /** CSS colour, e.g. "#ffffff". */
  color: string;
  align: "left" | "center" | "right";
  /** Line height multiplier, e.g. 1.02. */
  lineHeight: number;
  /** Opacity, 0–100. */
  opacity: number;
  /** Outline toggle. */
  stroke: boolean;
  /** Outline thickness in px, 1280×720 space. */
  strokeWidth: number;
  strokeColor: string;
  /** Hard drop shadow. */
  shadow: boolean;
  /** Optional background pill behind the text — turns a Text layer into a badge/pill. */
  bg: { enabled: boolean; color: string; padX: number; padY: number; radius: number };
  /** Optional special effect; absent or kind "none" = plain fill. */
  fx?: TextFx;
};

/** An uploaded/captured photo, or a built-in Claude brand mark (logo/wordmark). */
export type ImageLayer = LayerBase & {
  type: "image";
  /** Image source: a `data:` URL at runtime, a `blob:<id>` ref at rest. Null while empty
   *  or when `brand` is set. Agents get a `blob:<id>` ref from the upload_image tool. */
  src: string | null;
  /** Pre-background-removal original, for "Restore". Same encoding as `src`. */
  origSrc: string | null;
  /** Built-in Claude SVG mark; overrides `src` when set. Needs no upload. */
  brand: "logo" | "wordmark" | null;
  /** Fill colour for the brand mark. */
  brandColor: string;
  /** Size factor; 1 = base width (see BASE_IMG_W / brand bases in ThumbCanvas). */
  scale: number;
  /** Opacity, 0–100. */
  opacity: number;
  /** Mirror horizontally. */
  flip: boolean;
  /** Corner radius in px. */
  radius: number;
  /** Border around the image box. */
  ring: boolean;
  /** Border colour when `ringStyle` is "solid". */
  ringColor: string;
  /** Border fill: flat `ringColor`, or a multi-stop gradient traced around the edge.
   *  Absent reads as "solid". */
  ringStyle?: "solid" | "gradient";
  /** Gradient stops, used when `ringStyle` is "gradient". Absent reads as the holo set. */
  ringColors?: [string, string, string, string];
  /** Gradient angle in degrees (135 = top-left to bottom-right). Absent reads as 135. */
  ringAngle?: number;
  /** Border thickness in px, 1280×720 space. Absent reads as 10. */
  ringWidth?: number;
  /** Blur radius of a copy of the border painted behind the image, so the edge glows.
   *  0 or absent = off. */
  ringGlow?: number;
  /** Glow tracing the cut-out alpha edge. */
  glow: boolean;
  /** Soft glow, solid sticker outline, or a gradient outline with a matching halo. */
  glowStyle: "glow" | "line" | "gradient";
  /** Outline/glow colour for the "glow" and "line" styles. */
  glowColor: string;
  /** Blur radius ("glow") or outline thickness ("line", "gradient") in px. */
  glowSize: number;
  /** Gradient stops traced around the cut-out, used when `glowStyle` is "gradient".
   *  Absent reads as the holo set. */
  glowColors?: [string, string, string, string];
  /** Gradient angle in degrees (135 = top-left to bottom-right). Absent reads as 135. */
  glowAngle?: number;
  /** Blur radius of the coloured halo bleeding outside the gradient outline, in px.
   *  0 = no halo. Absent reads as 18. */
  glowHalo?: number;
  /** Halo opacity, 0–100. Absent reads as 70. */
  glowHaloOpacity?: number;
  /** Brightness via CSS filter, in % (100 = neutral). Absent reads as 100. */
  brightness?: number;
  /** Contrast via CSS filter, in % (100 = neutral). Absent reads as 100. */
  contrast?: number;
  /** Saturation via CSS filter, in % (100 = neutral). Absent reads as 100. */
  saturation?: number;
  /** Non-destructive crop: edge insets as fractions 0–1 of the full image; absent =
   *  uncropped. `src` is never altered — this just hides parts of it. */
  crop?: { l: number; t: number; r: number; b: number };
  /** Lasso polygon in full-image fractions; absent = no lasso. `crop` holds its bbox. */
  mask?: { points: { x: number; y: number }[] };
};

/** A single emoji / glyph. */
export type EmojiLayer = LayerBase & {
  type: "emoji";
  /** The emoji character itself, e.g. "🤯". */
  glyph: string;
  /** Rendered size in px, 1280×720 space. */
  size: number;
};

/** A field of emojis (confetti / fireworks / sparkles / 3D orbit) wrapping a target image.
 *  Bound: it centers on `targetId`'s bbox and is rendered straddling that image (some
 *  emojis behind, some in front). `x`/`y` are only used for the orphan fallback. */
export type EmojiFxLayer = LayerBase & {
  type: "emojifx";
  /** Id of the image layer this wraps; null or missing = centered orphan fallback. */
  targetId: string | null;
  pattern: "ring" | "scatter" | "burst";
  /** Emoji set, distributed round-robin over `count`. */
  glyphs: string[];
  /** Number of emoji instances. */
  count: number;
  /** Base emoji size in px (1280×720 space); depth-scaled per emoji. */
  size: number;
  /** Random size variance, 0–100. */
  sizeJitter: number;
  /** Ellipse radiusX (ring) / spread radius (scatter, burst), in canvas units. */
  radius: number;
  /** 0–1: radiusY = radius * tilt (flattens the ring into an orbit). Ring only. */
  tilt: number;
  /** 0–100: front-to-back scale & opacity contrast (the "3D" look). */
  depth: number;
  /** Random per-emoji rotation amount, 0–100. */
  spin: number;
  /** Seeds the PRNG so the arrangement is stable across render/undo/save/export. */
  seed: number;
};

/** A rectangle, pill, or the fake YouTube "watched" progress bar. */
export type ShapeLayer = LayerBase & {
  type: "shape";
  kind: "rect" | "pill" | "bar";
  fill: string;
  /** Width in 1280×720 space. */
  w: number;
  /** Height in 1280×720 space. */
  h: number;
  /** Corner radius. Ignored for "pill" (auto) and "bar". */
  radius: number;
  /** "bar" only: watched fraction, 0–100. */
  pct: number;
  /** "bar" only: unwatched track colour. */
  trackColor: string;
};

/** A React Bits background effect dropped onto the canvas as a movable, resizable box. */
export type EffectLayer = LayerBase & {
  type: "effect";
  /** Box width in 1280×720 space. */
  w: number;
  /** Box height in 1280×720 space. */
  h: number;
  /** Corner radius in px. */
  radius: number;
  /** Preset + params — same shape as a Background effect. */
  effect: BgEffect;
};

export type DrawCap = "none" | "arrow" | "dot" | "tee";

/** A freehand stroke. Points are bbox-relative (0..rawW, 0..rawH) in 1280×720 units.
 *  The rendered box pads the raw bbox by an amount derived from thickness + caps so the
 *  selection frame always hugs the *visible* ink (stroke + arrowheads), and `scale`
 *  resizes the whole thing like an image. x/y is the padded box's top-left. */
export type DrawLayer = LayerBase & {
  type: "draw";
  /** Stroke path, bbox-relative (0..rawW, 0..rawH) in 1280×720 units. */
  points: { x: number; y: number }[];
  /** Raw stroke bbox width (no padding) — constant. */
  rawW: number;
  /** Raw stroke bbox height (no padding) — constant. */
  rawH: number;
  /** Resize factor; 1 = drawn size. */
  scale: number;
  color: string;
  /** Stroke width in 1280×720 units. */
  thickness: number;
  lineStyle: "solid" | "dashed" | "dotted";
  /** 0–100: how aggressively the captured polyline is simplified before splining. */
  smoothing: number;
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

/** The canvas backdrop: a gradient, a flat colour, an image, an animated effect, or nothing
 *  at all. `transparent` paints no backdrop, and a PNG export keeps that alpha — which is what
 *  makes a design usable as an overlay (a stream frame, a sticker, a logo lockup). It never
 *  becomes a JPEG: the size ladder in `export.ts` is skipped, since flattening would fill the
 *  alpha with black. Anything painted over the whole canvas — `overlay`, the colour grade —
 *  still lands on top and will fill it back in, deliberately. */
export type Background = {
  mode: "gradient" | "solid" | "image" | "effect" | "transparent";
  /** Gradient start colour; also the fill when mode is "solid". */
  from: string;
  /** Gradient end colour. */
  to: string;
  /** Custom background image: a `data:` URL at runtime, a `blob:<id>` ref at rest. */
  image: string | null;
  /** Zoom % for image mode, 100–200 (default 100 = cover). */
  imageZoom?: number;
  /** Horizontal nudge % for image mode, -25…25 (default 0). */
  imageX?: number;
  /** Vertical nudge % for image mode, -25…25 (default 0) — e.g. to crop out a status bar. */
  imageY?: number;
  /** Darkness of the scrim over the background, 0–100. Raise it to keep text readable. */
  overlay: number;
  /** Present when mode is "effect". */
  effect?: BgEffect;
  /** Colour grade tint painted ON TOP of every layer, to make the composite cohesive. */
  gradeTint?: string;
  /** Tint strength, 0–100. */
  gradeAmount?: number;
  gradeBlend?: "soft-light" | "overlay" | "multiply" | "screen" | "color";
  /** Darkened edges, 0–100. */
  gradeVignette?: number;
  /** Film grain, 0–100. */
  gradeGrain?: number;
  /** Full-canvas frame border painted on top of every layer. Absent = off. */
  border?: BgBorder;
};

export type BgBorderStyle = "solid" | "dashed" | "dotted" | "double";

export type BgBorder = {
  enabled: boolean;
  color: string;
  /** Stroke thickness in px. */
  width: number;
  /** Corner roundness of the inner edge, in px. */
  radius: number;
  style: BgBorderStyle;
  /** Gap between the canvas edge and the border box, in px. */
  inset: number;
  /** Opacity, 0–100. */
  opacity: number;
};

/** Fresh defaults for the full-canvas border — thick black frame with rounded inner corners. */
export function defaultBgBorder(): BgBorder {
  return { enabled: false, color: "#000000", width: 24, radius: 32, style: "solid", inset: 0, opacity: 100 };
}

/** Merge stored border with defaults so callers never need to null-check every field. */
export function resolveBgBorder(border?: BgBorder): BgBorder {
  return { ...defaultBgBorder(), ...border };
}

/** Iridescent stops of the gradient image border — duck-ui's `--holo`, converted to sRGB hex
 *  (the colour inputs are hex, and a picker can't round-trip an oklch string). */
export const HOLO_STOPS: [string, string, string, string] = ["#c27dff", "#5fb6ff", "#00d9d9", "#70ec90"];

export type ResolvedRing = {
  style: "solid" | "gradient";
  colors: [string, string, string, string];
  angle: number;
  width: number;
  glow: number;
};

/** Fill every optional border field of an image layer. The extras are optional so docs written
 *  before the gradient border still read as the plain 10px ring they were saved as. */
export function resolveRing(layer: ImageLayer): ResolvedRing {
  return {
    style: layer.ringStyle ?? "solid",
    colors: layer.ringColors ?? HOLO_STOPS,
    angle: layer.ringAngle ?? 135,
    width: layer.ringWidth ?? 10,
    glow: layer.ringGlow ?? 0,
  };
}

export type ResolvedGlow = {
  colors: [string, string, string, string];
  angle: number;
  halo: number;
  haloOpacity: number;
};

/** Fill every optional field of the gradient cut-out outline. Same reason as `resolveRing`:
 *  docs written before the gradient style must keep reading as what they were saved as. */
export function resolveGlow(layer: ImageLayer): ResolvedGlow {
  return {
    colors: layer.glowColors ?? HOLO_STOPS,
    angle: layer.glowAngle ?? 135,
    halo: layer.glowHalo ?? 18,
    haloOpacity: layer.glowHaloOpacity ?? 70,
  };
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

/**
 * A complete design document: a canvas format, a background, and a flat ordered list of
 * layers. Array order IS paint order (index 0 is furthest back). There is no nesting —
 * every layer carries its own absolute `x`/`y` in 1280×720 authoring space.
 */
export type ThumbDoc = {
  /** Canvas size preset; pixel dimensions via canvasSize(). */
  format: FormatKey;
  background: Background;
  /** Painted back to front: index 0 is the bottom layer. */
  layers: Layer[];
};

export type AppState = { doc: ThumbDoc; selectedIds: string[] };

/** The layer that drives the single-layer Inspector — the last one selected. */
export const primaryId = (s: AppState): string | null => s.selectedIds[s.selectedIds.length - 1] ?? null;

// ── Layer factories ─────────────────────────────────────────────────────────

/** A fresh layer id. Exported because anything that *copies* a layer into a document — the
 *  favourites palette, the MCP tools — has to re-id it or two layers collide. */
export const newLayerId = (): string => crypto.randomUUID();
const uid = newLayerId;

/** Strips everything that only makes sense inside a layer's original document: the group
 *  link, and for emoji fields the bound target image (it won't exist in the destination).
 *  Lives here, not in storage.ts, because it's document-model logic — and the MCP server
 *  needs it without dragging in a module full of browser `fetch`. */
export function detachLayer(layer: Layer): Layer {
  const { groupId: _drop, ...rest } = layer;
  if (rest.type === "emojifx") return { ...rest, targetId: null } as EmojiFxLayer;
  return rest as Layer;
}

export function newTextLayer(): TextLayer {
  return {
    id: uid(),
    type: "text",
    name: "Text",
    x: 120,
    y: 120,
    rotation: 0,
    visible: true,
    text: "NEW TEXT",
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
    name: "Image",
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
    name: "Effect",
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
  { label: "Confetti", glyphs: ["🎉", "🎊", "✨"] },
  { label: "Fireworks", glyphs: ["🎆", "🎇", "💥", "✨"] },
  { label: "Sparkles", glyphs: ["✨", "⭐", "💫", "🌟"] },
  { label: "Hearts", glyphs: ["❤️", "💕", "💖", "💗"] },
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
    name: "Emoji effect",
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
  if (kind === "bar") return { ...base, name: "Progress bar", kind, fill: "#ff0000", x: 0, y: CANVAS_H - 14, w: CANVAS_W, h: 14 };
  if (kind === "pill") return { ...base, name: "Pill", kind, fill: "#e8633a", x: 120, y: 120, w: 280, h: 70, radius: 999 };
  return { ...base, name: "Rectangle", kind, fill: "#e8633a", x: 120, y: 120, w: 320, h: 200 };
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
    name: "Drawing",
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

/** Upgrade a loaded doc in place: backfill `format` on docs saved before multi-format,
 *  and convert draw layers saved before the rawW/scale schema (they stored vw/vh/w/h
 *  with a 16px pad baked into points) to the current shape. */
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
  return { ...doc, format: doc.format ?? DEFAULT_FORMAT, layers };
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
  | { type: "moveLayers"; ids: string[]; toIndex: number } // drag-reorder: lift a set, reinsert it at a gap
  | { type: "group"; ids: string[] }
  | { type: "ungroup"; ids: string[] }
  | { type: "updateBackground"; patch: Partial<Background> }
  | { type: "setFormat"; format: FormatKey }; // switch canvas format; layers translate by center delta

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
    // Drag-reorder in the layer list. `toIndex` is a *gap* in the current array
    // (0 = behind everything, layers.length = in front of everything). The moved set
    // is lifted out keeping its relative order, then reinserted at that gap — which
    // is why the gap has to be rebased onto the array-without-the-moved-layers.
    case "moveLayers": {
      const set = new Set(action.ids);
      const moving = state.doc.layers.filter((l) => set.has(l.id));
      if (!moving.length) return state;
      const rest = state.doc.layers.filter((l) => !set.has(l.id));
      const lifted = state.doc.layers.slice(0, action.toIndex).filter((l) => set.has(l.id)).length;
      const at = Math.max(0, Math.min(rest.length, action.toIndex - lifted));
      const layers = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
      // Dropping a set back where it already was must not cost an undo entry.
      if (layers.every((l, i) => l === state.doc.layers[i])) return state;
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
    case "setFormat": {
      if (action.format === state.doc.format) return state; // no-op → historyReducer drops it
      const from = canvasSize(state.doc.format);
      const to = canvasSize(action.format);
      const dx = (to.w - from.w) / 2;
      const dy = (to.h - from.h) / 2;
      return {
        ...state,
        doc: {
          ...state.doc,
          format: action.format,
          layers: state.doc.layers.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })),
        },
      };
    }
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
