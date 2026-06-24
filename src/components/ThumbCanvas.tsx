import type { CSSProperties, Dispatch, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { CANVAS_H, CANVAS_W, FONTS, FONT_WEIGHT, type Action, type ImageLayer, type Layer, type LayerPatch, type TextLayer, type ThumbDoc } from "../state";
import { ClaudeLogo, ClaudeWordmark } from "./brand";
import { EffectBackground } from "./EffectBackground";

export { CANVAS_H, CANVAS_W };

const SELECT_COLOR = "#4aa3ff";
const BASE_IMG_W = 360; // width at scale 1 for an uploaded photo
const LOGO_W = 120; // brand logo base width (square)
const WORDMARK_ASPECT = 426 / 125; // viewBox of the cropped "Claude" wordmark

/** Stacked drop-shadows trace the cut-out's alpha edge → a glow around the silhouette. */
function glowFilter(l: ImageLayer): string | undefined {
  if (!l.glow) return undefined;
  const s = l.glowSize;
  return [s, s, Math.round(s / 2)].map((r) => `drop-shadow(0 0 ${r}px ${l.glowColor})`).join(" ");
}

type Props = {
  doc: ThumbDoc;
  scale: number;
  selectedId: string | null;
  exporting: boolean;
  canvasRef: RefObject<HTMLDivElement | null>;
  dispatch: Dispatch<Action>;
};

export function ThumbCanvas({ doc, scale, selectedId, exporting, canvasRef, dispatch }: Props) {
  const bg = doc.background;
  const background =
    bg.mode === "image" && bg.image
      ? `#000 url(${bg.image}) center / cover no-repeat`
      : bg.mode === "gradient"
        ? `radial-gradient(circle at 68% 32%, ${bg.from}, ${bg.to} 72%)`
        : bg.mode === "effect"
          ? "#000" // backdrop behind the effect (aurora has transparency)
          : bg.from;

  /** pointerdown on a layer: select it, then stream drag deltas (divided by screen scale). */
  function startDrag(e: ReactPointerEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    dispatch({ type: "select", id });
    let last = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      dispatch({ type: "nudge", id, dx: (ev.clientX - last.x) / scale, dy: (ev.clientY - last.y) / scale });
      last = { x: ev.clientX, y: ev.clientY };
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={canvasRef}
      onPointerDown={() => dispatch({ type: "select", id: null })}
      style={{
        width: CANVAS_W,
        height: CANVAS_H,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        position: "relative",
        overflow: "hidden",
        background,
        userSelect: "none",
      }}
    >
      {bg.mode === "effect" && bg.effect && <EffectBackground effect={bg.effect} />}
      {bg.overlay > 0 && <div style={{ position: "absolute", inset: 0, background: "#000", opacity: bg.overlay / 100 }} />}

      {doc.layers.map((layer) =>
        layer.visible ? (
          <div
            key={layer.id}
            data-lbox
            onPointerDown={(e) => startDrag(e, layer.id)}
            style={{
              position: "absolute",
              left: layer.x,
              top: layer.y,
              transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
              cursor: "grab",
              touchAction: "none",
            }}
          >
            <LayerContent layer={layer} />
            {!exporting && layer.id === selectedId && (
              <SelectionFrame layer={layer} scale={scale} canvasRef={canvasRef} dispatch={dispatch} />
            )}
          </div>
        ) : null
      )}
    </div>
  );
}

/** Transform handles drawn inside the selected layer's box, so they ride along with
 *  its position and rotation for free. Corners scale the layer around its (rotation-
 *  invariant) centre; the top knob rotates it. Handles counter-scale by `scale` so
 *  they stay a constant on-screen size regardless of canvas zoom. */
function SelectionFrame({
  layer, scale, canvasRef, dispatch,
}: { layer: Layer; scale: number; canvasRef: RefObject<HTMLDivElement | null>; dispatch: Dispatch<Action> }) {
  const h = 11 / scale; // handle size in canvas units → ~11px on screen
  const bw = 1.5 / scale; // frame/handle border width
  const pad = 3 / scale; // breathing room outside the content box
  const gap = 26 / scale; // rotate-knob distance above the top edge

  const toCanvas = (rect: DOMRect, cx: number, cy: number) => ({ x: (cx - rect.left) / scale, y: (cy - rect.top) / scale });

  function begin(e: ReactPointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-lbox]");
    const canvas = canvasRef.current;
    if (!box || !canvas) return null;
    const w = box.offsetWidth, ht = box.offsetHeight; // unrotated layout size, canvas units
    return { box, rect: canvas.getBoundingClientRect(), cx: layer.x + w / 2, cy: layer.y + ht / 2, w, h: ht };
  }

  function drag(move: (e: PointerEvent) => void) {
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startResize(e: ReactPointerEvent) {
    const s = begin(e);
    if (!s) return;
    const p0 = toCanvas(s.rect, e.clientX, e.clientY);
    const startDist = Math.hypot(p0.x - s.cx, p0.y - s.cy) || 1;
    const base = layer;
    // Bound the scale factor so the resized value stays within the matching
    // Inspector slider's range — canvas and slider then never disagree.
    let fMin = 0.05, fMax = 40;
    if (base.type === "image") { fMin = 0.2 / base.scale; fMax = 3 / base.scale; }
    else if (base.type === "shape" || base.type === "effect") { fMin = Math.max(20 / base.w, 6 / base.h); fMax = Math.min(1280 / base.w, 720 / base.h); }
    else { const lo = base.type === "emoji" ? 40 : 24, hi = base.type === "emoji" ? 360 : 220; fMin = lo / base.size; fMax = hi / base.size; }
    drag((ev) => {
      const p = toCanvas(s.rect, ev.clientX, ev.clientY);
      const f = Math.min(fMax, Math.max(fMin, Math.hypot(p.x - s.cx, p.y - s.cy) / startDist));
      const nw = s.w * f, nh = s.h * f;
      const pos = { x: s.cx - nw / 2, y: s.cy - nh / 2 };
      let patch: LayerPatch;
      if (base.type === "image") patch = { ...pos, scale: base.scale * f };
      else if (base.type === "shape" || base.type === "effect") patch = { ...pos, w: base.w * f, h: base.h * f };
      else patch = { ...pos, size: Math.round((base as TextLayer).size * f) };
      dispatch({ type: "updateLayer", id: layer.id, patch });
    });
  }

  function startRotate(e: ReactPointerEvent) {
    const s = begin(e);
    if (!s) return;
    const p0 = toCanvas(s.rect, e.clientX, e.clientY);
    const a0 = Math.atan2(p0.y - s.cy, p0.x - s.cx);
    const baseRot = layer.rotation;
    drag((ev) => {
      const p = toCanvas(s.rect, ev.clientX, ev.clientY);
      const a = Math.atan2(p.y - s.cy, p.x - s.cx);
      let deg = baseRot + ((a - a0) * 180) / Math.PI;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = ((Math.round(deg) % 360) + 540) % 360 - 180; // normalise to (-180, 180]
      dispatch({ type: "updateLayer", id: layer.id, patch: { rotation: deg } });
    });
  }

  const knob = (extra: CSSProperties): CSSProperties => ({
    position: "absolute", width: h, height: h, background: "#fff",
    border: `${bw}px solid ${SELECT_COLOR}`, borderRadius: 2 / scale, boxSizing: "border-box",
    pointerEvents: "auto", ...extra,
  });

  return (
    <div style={{ position: "absolute", inset: -pad, border: `${bw}px solid ${SELECT_COLOR}`, pointerEvents: "none", boxSizing: "border-box" }}>
      <div style={{ position: "absolute", left: "50%", top: -gap, width: bw, height: gap, background: SELECT_COLOR, transform: "translateX(-50%)" }} />
      <div onPointerDown={startRotate} style={knob({ left: "50%", top: -gap, borderRadius: "50%", transform: "translate(-50%,-50%)", cursor: "grab" })} />
      <div onPointerDown={startResize} style={knob({ left: -h / 2, top: -h / 2, cursor: "nwse-resize" })} />
      <div onPointerDown={startResize} style={knob({ right: -h / 2, top: -h / 2, cursor: "nesw-resize" })} />
      <div onPointerDown={startResize} style={knob({ left: -h / 2, bottom: -h / 2, cursor: "nesw-resize" })} />
      <div onPointerDown={startResize} style={knob({ right: -h / 2, bottom: -h / 2, cursor: "nwse-resize" })} />
    </div>
  );
}

function LayerContent({ layer }: { layer: Layer }) {
  switch (layer.type) {
    case "text":
      return <TextContent layer={layer} />;

    case "emoji":
      return <div style={{ fontSize: layer.size, lineHeight: 1 }}>{layer.glyph}</div>;

    case "image":
      return <ImageContent layer={layer} />;

    case "shape": {
      if (layer.kind === "bar") {
        return (
          <div style={{ width: layer.w, height: layer.h, background: layer.trackColor, position: "relative" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${layer.pct}%`, background: layer.fill }} />
          </div>
        );
      }
      return (
        <div
          style={{
            width: layer.w,
            height: layer.h,
            background: layer.fill,
            borderRadius: layer.kind === "pill" ? layer.h / 2 : layer.radius,
          }}
        />
      );
    }

    case "effect":
      return (
        <div style={{ width: layer.w, height: layer.h, borderRadius: layer.radius, overflow: "hidden", position: "relative" }}>
          <EffectBackground effect={layer.effect} />
        </div>
      );
  }
}

/** Text layer, including its optional React Bits effect (gradient / shiny / glitch). */
function TextContent({ layer }: { layer: TextLayer }) {
  const fx = layer.fx;
  // gradient/shiny "fill" the glyphs via background-clip:text, so they own `background` and
  // suppress the pill. Their movement is a CSS animation (frozen to one frame on PNG export).
  const clip = fx?.kind === "gradient" || fx?.kind === "shiny";
  const style: CSSProperties = {
    display: "inline-block",
    fontFamily: FONTS[layer.font],
    fontSize: layer.size,
    fontWeight: FONT_WEIGHT[layer.font],
    lineHeight: layer.lineHeight,
    color: clip ? "transparent" : layer.color,
    textAlign: layer.align,
    whiteSpace: "pre",
    WebkitTextStroke: layer.stroke ? "5px #000000" : undefined,
    paintOrder: "stroke fill",
    textShadow: layer.shadow ? "0 8px 0 rgba(0,0,0,.85)" : undefined,
    background: layer.bg.enabled && !clip ? layer.bg.color : undefined,
    padding: layer.bg.enabled && !clip ? `${layer.bg.padY}px ${layer.bg.padX}px` : undefined,
    borderRadius: layer.bg.enabled && !clip ? layer.bg.radius : undefined,
  };

  if (fx?.kind === "gradient") {
    const angle = fx.direction === "horizontal" ? "to right" : fx.direction === "vertical" ? "to bottom" : "to bottom right";
    const size = fx.direction === "horizontal" ? "300% 100%" : fx.direction === "vertical" ? "100% 300%" : "300% 300%";
    const anim = fx.direction === "horizontal" ? "rb-gradient-x" : fx.direction === "vertical" ? "rb-gradient-y" : "rb-gradient-d";
    Object.assign(style, {
      backgroundImage: `linear-gradient(${angle}, ${[...fx.colors, fx.colors[0]].join(", ")})`,
      backgroundSize: size,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      WebkitTextFillColor: "transparent",
      animation: `${anim} ${fx.speed}s ease infinite alternate`,
    });
  } else if (fx?.kind === "shiny") {
    Object.assign(style, {
      backgroundImage: `linear-gradient(${fx.spread}deg, ${fx.color} 0%, ${fx.color} 35%, ${fx.shineColor} 50%, ${fx.color} 65%, ${fx.color} 100%)`,
      backgroundSize: "200% auto",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      WebkitTextFillColor: "transparent",
      animation: `rb-shine ${fx.speed}s linear infinite${fx.direction === "right" ? " reverse" : ""}`,
    });
  } else if (fx?.kind === "glitch") {
    // Glitch needs ::before/::after pseudo-elements → the .rb-glitch class in styles.css,
    // driven by CSS custom properties. data-text feeds the pseudo content.
    const vars: Record<string, string> = {
      "--before-duration": `${fx.speed * 2}s`,
      "--after-duration": `${fx.speed * 3}s`,
      "--before-shadow": fx.enableShadows ? `5px 0 ${fx.color1}` : "none",
      "--after-shadow": fx.enableShadows ? `-5px 0 ${fx.color2}` : "none",
    };
    return (
      <div className="rb-glitch" data-text={layer.text} style={{ ...style, ...vars } as CSSProperties}>
        {layer.text}
      </div>
    );
  }

  return <div style={style}>{layer.text}</div>;
}

function ImageContent({ layer }: { layer: ImageLayer }) {
  const flip = layer.flip ? "scaleX(-1)" : undefined;

  if (layer.brand) {
    const w = (layer.brand === "logo" ? LOGO_W : BASE_IMG_W) * layer.scale;
    const h = layer.brand === "logo" ? w : w / WORDMARK_ASPECT;
    return (
      <div style={{ width: w, height: h, transform: flip }}>
        {layer.brand === "logo" ? <ClaudeLogo color={layer.brandColor} /> : <ClaudeWordmark color={layer.brandColor} />}
      </div>
    );
  }

  const w = BASE_IMG_W * layer.scale;
  const ring = layer.ring ? `10px solid ${layer.ringColor}` : undefined;

  if (!layer.src) {
    return (
      <div
        style={{
          width: w,
          height: w * 1.2,
          background: "#666666",
          borderRadius: layer.radius,
          border: ring,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          fontFamily: "'Inter', sans-serif",
          fontSize: 26,
          textAlign: "center",
        }}
      >
        carica foto →
      </div>
    );
  }

  return (
    <img
      src={layer.src}
      draggable={false}
      style={{
        display: "block",
        width: w,
        height: "auto",
        borderRadius: layer.radius,
        transform: flip,
        border: ring,
        boxSizing: "border-box",
        filter: glowFilter(layer),
      }}
    />
  );
}
