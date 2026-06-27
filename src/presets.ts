// Starting templates. Each is a factory that returns a fresh ThumbDoc (new layer
// ids every call) so loading a template twice never collides. The user is free to
// add / move / delete layers afterwards — templates are a starting point, not a mode.
//
// Multi-colour titles become separate Text layers (each line independently
// movable). Badges and episode pills are Text layers with a background pill.
// The fake "watched" bar is a Shape layer of kind "bar".

import {
  CANVAS_H,
  CANVAS_W,
  type EmojiLayer,
  type FontKey,
  type ImageLayer,
  type Layer,
  type ShapeLayer,
  type TextLayer,
  type ThumbDoc,
} from "./state";

export type TemplateKey = "dacoder" | "loud" | "brand" | "dev" | "hype" | "number" | "split" | "minimal";

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  dacoder: "dacoder",
  loud: "Loud",
  brand: "Brand",
  dev: "Dev",
  hype: "Hype",
  number: "Numerone",
  split: "Prima/Dopo",
  minimal: "Minimal",
};

const uid = () => crypto.randomUUID();

type TextOpts = Partial<TextLayer> & { text: string; x: number; y: number };
function text({ text, x, y, ...rest }: TextOpts): TextLayer {
  return {
    id: uid(),
    type: "text",
    name: text.split("\n")[0].slice(0, 20) || "Testo",
    x,
    y,
    rotation: 0,
    visible: true,
    text,
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
    ...rest,
  };
}

/** A text pill (badge / episode tag): a Text layer with its background enabled. */
function pill(o: TextOpts & { bgColor: string }): TextLayer {
  const { bgColor, ...t } = o;
  return text({
    font: "inter",
    size: 38,
    color: "#ffffff",
    ...t,
    bg: { enabled: true, color: bgColor, padX: 24, padY: 8, radius: 12 },
  });
}

function face(o: Partial<ImageLayer> & { x: number; y: number }): ImageLayer {
  return {
    id: uid(),
    type: "image",
    name: "Foto",
    rotation: 0,
    visible: true,
    src: null,
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
    ...o,
  };
}

function emoji(o: Partial<EmojiLayer> & { glyph: string; x: number; y: number }): EmojiLayer {
  return { id: uid(), type: "emoji", name: "Emoji", rotation: 0, visible: true, size: 150, ...o };
}

function bar(pct: number, fill: string): ShapeLayer {
  return {
    id: uid(),
    type: "shape",
    name: "Barra progresso",
    kind: "bar",
    x: 0,
    y: CANVAS_H - 14,
    w: CANVAS_W,
    h: 14,
    rotation: 0,
    visible: true,
    fill,
    radius: 0,
    pct,
    trackColor: "rgba(255,255,255,.35)",
  };
}

function doc(background: ThumbDoc["background"], layers: Layer[]): ThumbDoc {
  return { background, layers };
}

const SERIF: FontKey = "georgia";

export const TEMPLATES: Record<TemplateKey, () => ThumbDoc> = {
  // Default seed: the channel's own intro thumbnail. Face slot = "me", the
  // @dacoder handle + `$ dacoder` terminal prompt brand it. Edit per video.
  dacoder: () =>
    doc({ mode: "gradient", from: "#0d1b13", to: "#04070a", image: null, overlay: 0 }, [
      text({ text: "$ dacoder", x: 64, y: 44, size: 30, font: "mono", color: "#3ddc84" }),
      text({ text: "CODING", x: 64, y: 150, size: 138, rotation: -2, stroke: true, shadow: true }),
      text({ text: "DAL VIVO", x: 64, y: 300, size: 138, color: "#3ddc84", rotation: -2, stroke: true, shadow: true }),
      emoji({ glyph: "👨‍💻", x: 800, y: 70, size: 140, rotation: 10 }),
      face({ x: 880, y: 260, ring: true, ringColor: "#3ddc84", glow: true, glowColor: "#3ddc84", glowSize: 18 }),
      pill({ text: "▶ @dacoder · iscriviti", x: 64, y: 632, size: 30, color: "#04130b", bgColor: "#3ddc84" }),
      bar(64, "#3ddc84"),
    ]),

  loud: () =>
    doc({ mode: "gradient", from: "#3a1d0e", to: "#120a06", image: null, overlay: 0 }, [
      pill({ text: "🔴 LIVE", x: 64, y: 40, bgColor: "#ff0000" }),
      text({ text: "CLAUDE CODE", x: 64, y: 150, size: 96, rotation: -2, stroke: true, shadow: true }),
      text({ text: "LEGGE GLI", x: 64, y: 252, size: 96, rotation: -2, stroke: true, shadow: true }),
      text({ text: "SCONTRINI", x: 64, y: 354, size: 96, color: "#ffd400", rotation: -2, stroke: true, shadow: true }),
      emoji({ glyph: "🤯", x: 800, y: 90, size: 150, rotation: 12 }),
      face({ x: 880, y: 280, ring: true }),
      pill({ text: "EP.2 — GROCERY APP + LLM VISION", x: 64, y: 638, size: 30, bgColor: "#e8633a" }),
      bar(72, "#ff0000"),
    ]),

  brand: () =>
    doc({ mode: "solid", from: "#fbf7f0", to: "#f2ebdd", image: null, overlay: 0 }, [
      pill({ text: "● LIVE EP.2", x: 64, y: 40, bgColor: "#e8633a" }),
      text({ text: "L'AI legge", x: 64, y: 200, size: 92, font: SERIF, color: "#2d2520" }),
      text({ text: "i miei scontrini", x: 64, y: 300, size: 92, font: SERIF, color: "#e8633a" }),
      face({ x: 900, y: 300, scale: 0.95 }),
      pill({ text: "sviluppo live di una vera web app", x: 64, y: 632, size: 28, bgColor: "#e8633a" }),
    ]),

  dev: () =>
    doc({ mode: "solid", from: "#1e1e2e", to: "#1e1e2e", image: null, overlay: 0 }, [
      text({
        text: "const receipt = await kimi.parse(img)\n// vision LLM → items[]\nif (receipt.total > budget) alert()",
        x: 56,
        y: 48,
        size: 26,
        font: "mono",
        color: "#6c7086",
        lineHeight: 1.8,
      }),
      pill({ text: "● LIVE EP.2", x: 64, y: 40, bgColor: "#f38ba8" }),
      text({ text: "LLM VISION", x: 64, y: 220, size: 100, shadow: true }),
      text({ text: "+ SCONTRINI", x: 64, y: 322, size: 100, color: "#e8633a", shadow: true }),
      emoji({ glyph: "👨‍💻", x: 820, y: 100, size: 120 }),
      face({ x: 890, y: 290 }),
      pill({ text: "coding live con Claude Code", x: 64, y: 632, size: 28, bgColor: "#e8633a" }),
      bar(80, "#ff0000"),
    ]),

  hype: () =>
    doc({ mode: "gradient", from: "#ff5a1f", to: "#2a0700", image: null, overlay: 0 }, [
      pill({ text: "🔥 PAZZESCO", x: 64, y: 40, bgColor: "#ff0000" }),
      text({ text: "HO SPESO", x: 64, y: 150, size: 124, rotation: -3, stroke: true, shadow: true }),
      text({ text: "€1.000?!", x: 64, y: 290, size: 124, color: "#ffd400", rotation: -3, stroke: true, shadow: true }),
      emoji({ glyph: "💸", x: 760, y: 60, size: 200, rotation: 14 }),
      face({ x: 840, y: 250, scale: 1.05, glow: true, glowColor: "#ffe600", glowSize: 22 }),
      bar(88, "#ff0000"),
    ]),

  number: () =>
    doc({ mode: "gradient", from: "#1b2a4a", to: "#070b14", image: null, overlay: 0 }, [
      text({ text: "LO SPRECO?", x: 64, y: 180, size: 100, stroke: true, shadow: true }),
      text({ text: "€1.248", x: 64, y: 300, size: 150, color: "#ff3b3b", stroke: true, shadow: true }),
      face({ x: 980, y: 350, scale: 0.78, glow: true, glowColor: "#ff3b3b", glowSize: 16 }),
    ]),

  split: () =>
    doc({ mode: "gradient", from: "#0a3d62", to: "#b71540", image: null, overlay: 0 }, [
      pill({ text: "PRIMA / DOPO", x: 64, y: 40, bgColor: "#1f6feb" }),
      text({ text: "PRIMA", x: 64, y: 200, size: 132, stroke: true, shadow: true }),
      text({ text: "→ DOPO", x: 64, y: 350, size: 132, color: "#ffd400", stroke: true, shadow: true }),
      emoji({ glyph: "⚡", x: 770, y: 70, size: 150, rotation: 8 }),
      face({ x: 860, y: 270, glow: true, glowColor: "#19c3ff", glowSize: 20 }),
    ]),

  minimal: () =>
    doc({ mode: "gradient", from: "#f7f3ec", to: "#ece4d6", image: null, overlay: 0 }, [
      text({ text: "Spesa", x: 96, y: 220, size: 100, font: SERIF, color: "#1a1a1a" }),
      text({ text: "intelligente", x: 96, y: 330, size: 100, font: SERIF, color: "#c2410c" }),
      face({ x: 920, y: 300, scale: 0.9, radius: 24 }),
    ]),
};
