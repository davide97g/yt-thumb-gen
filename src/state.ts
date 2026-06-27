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
  | "segoe";

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
};

export type LayerType = "text" | "image" | "emoji" | "shape" | "effect";

/** Fields shared by every layer. */
type LayerBase = {
  id: string;
  type: LayerType;
  name: string; // shown in the layer list
  x: number; // top-left, 1280×720 space
  y: number;
  rotation: number; // degrees
  visible: boolean;
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
  glowColor: string;
  glowSize: number;
};

/** A single emoji / glyph. */
export type EmojiLayer = LayerBase & {
  type: "emoji";
  glyph: string;
  size: number;
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

export type Layer = TextLayer | ImageLayer | EmojiLayer | ShapeLayer | EffectLayer;

/** A partial patch for any single layer type (used by inspectors → updateLayer). */
export type LayerPatch =
  | Partial<TextLayer>
  | Partial<ImageLayer>
  | Partial<EmojiLayer>
  | Partial<ShapeLayer>
  | Partial<EffectLayer>;

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
  overlay: number; // 0–100 darkness of the scrim over the background
  effect?: BgEffect; // present when mode === "effect"
};

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

export type AppState = { doc: ThumbDoc; selectedId: string | null };

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

export function newShapeLayer(kind: ShapeLayer["kind"]): ShapeLayer {
  const base = { id: uid(), type: "shape" as const, rotation: 0, visible: true, radius: 16, pct: 72, trackColor: "rgba(255,255,255,.35)" };
  if (kind === "bar") return { ...base, name: "Barra progresso", kind, fill: "#ff0000", x: 0, y: CANVAS_H - 14, w: CANVAS_W, h: 14 };
  if (kind === "pill") return { ...base, name: "Pillola", kind, fill: "#e8633a", x: 120, y: 120, w: 280, h: 70, radius: 999 };
  return { ...base, name: "Rettangolo", kind, fill: "#e8633a", x: 120, y: 120, w: 320, h: 200 };
}

// ── Reducer ───────────────────────────────────────────────────────────────────

export type Action =
  | { type: "loadDoc"; doc: ThumbDoc } // template / saved config / imported file
  | { type: "select"; id: string | null }
  | { type: "addLayer"; layer: Layer }
  | { type: "pasteLayer"; layer: Layer } // clone of `layer`, inserted above the selection
  | { type: "updateLayer"; id: string; patch: LayerPatch }
  | { type: "nudge"; id: string; dx: number; dy: number } // drag delta
  | { type: "removeLayer"; id: string }
  | { type: "reorder"; id: string; dir: -1 | 1 } // move one step in z-order
  | { type: "updateBackground"; patch: Partial<Background> };

function mapLayer(doc: ThumbDoc, id: string, fn: (l: Layer) => Layer): ThumbDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? fn(l) : l)) };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "loadDoc":
      return { doc: action.doc, selectedId: null };
    case "select":
      return { ...state, selectedId: action.id };
    case "addLayer":
      return { doc: { ...state.doc, layers: [...state.doc.layers, action.layer] }, selectedId: action.layer.id };
    case "pasteLayer": {
      // ponytail: +24px offset so the clone is visibly distinct from its source.
      const clone = { ...action.layer, id: uid(), x: action.layer.x + 24, y: action.layer.y + 24 } as Layer;
      const layers = [...state.doc.layers];
      const i = state.selectedId ? layers.findIndex((l) => l.id === state.selectedId) : -1;
      layers.splice(i >= 0 ? i + 1 : layers.length, 0, clone); // i+1 = directly above the selection
      return { doc: { ...state.doc, layers }, selectedId: clone.id };
    }
    case "updateLayer":
      return { ...state, doc: mapLayer(state.doc, action.id, (l) => Object.assign({}, l, action.patch) as Layer) };
    case "nudge":
      return { ...state, doc: mapLayer(state.doc, action.id, (l) => ({ ...l, x: l.x + action.dx, y: l.y + action.dy })) };
    case "removeLayer":
      return {
        doc: { ...state.doc, layers: state.doc.layers.filter((l) => l.id !== action.id) },
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    case "reorder": {
      const layers = [...state.doc.layers];
      const i = layers.findIndex((l) => l.id === action.id);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= layers.length) return state;
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...state, doc: { ...state.doc, layers } };
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
      return `nudge:${action.id}`;
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
