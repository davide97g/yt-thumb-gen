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
  sfpro: "SF Pro Display",
  helvetica: "Helvetica Neue",
  segoe: "Segoe UI Variable",
};

export type LayerType = "text" | "image" | "emoji" | "shape";

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

/** A run of text. Today's title lines, badge, and episode pill are all Text layers. */
export type TextLayer = LayerBase & {
  type: "text";
  text: string; // multi-line via \n
  font: FontKey;
  size: number; // px in 1280×720 space
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  stroke: boolean; // black outline
  shadow: boolean; // hard drop shadow
  /** Optional background pill behind the text — turns a Text layer into a badge/pill. */
  bg: { enabled: boolean; color: string; padX: number; padY: number; radius: number };
};

/** An uploaded/captured photo, or a built-in Claude brand mark (logo/wordmark). */
export type ImageLayer = LayerBase & {
  type: "image";
  src: string | null; // dataURL; null while empty or when `brand` is set
  origSrc: string | null; // pre-background-removal original, for "Ripristina"
  brand: "logo" | "wordmark" | null; // built-in Claude SVG mark; overrides src when set
  brandColor: string; // fill colour for the brand mark
  scale: number; // 1 = base width (see BASE_IMG_W / brand bases in ThumbCanvas)
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

export type Layer = TextLayer | ImageLayer | EmojiLayer | ShapeLayer;

/** A partial patch for any single layer type (used by inspectors → updateLayer). */
export type LayerPatch =
  | Partial<TextLayer>
  | Partial<ImageLayer>
  | Partial<EmojiLayer>
  | Partial<ShapeLayer>;

export type Background = {
  mode: "gradient" | "solid" | "image";
  from: string;
  to: string;
  image: string | null; // dataURL for a custom background image
  overlay: number; // 0–100 darkness of the scrim over the background
};

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
    stroke: false,
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
