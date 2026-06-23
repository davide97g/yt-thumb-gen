import type { Dispatch, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { CANVAS_H, CANVAS_W, FONTS, FONT_WEIGHT, type Action, type ImageLayer, type Layer, type ThumbDoc } from "../state";
import { ClaudeLogo, ClaudeWordmark } from "./brand";

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
      {bg.overlay > 0 && <div style={{ position: "absolute", inset: 0, background: "#000", opacity: bg.overlay / 100 }} />}

      {doc.layers.map((layer) =>
        layer.visible ? (
          <div
            key={layer.id}
            onPointerDown={(e) => startDrag(e, layer.id)}
            style={{
              position: "absolute",
              left: layer.x,
              top: layer.y,
              transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
              cursor: "grab",
              touchAction: "none",
              outline: !exporting && layer.id === selectedId ? `2px solid ${SELECT_COLOR}` : undefined,
              outlineOffset: 3,
            }}
          >
            <LayerContent layer={layer} />
          </div>
        ) : null
      )}
    </div>
  );
}

function LayerContent({ layer }: { layer: Layer }) {
  switch (layer.type) {
    case "text":
      return (
        <div
          style={{
            display: "inline-block",
            fontFamily: FONTS[layer.font],
            fontSize: layer.size,
            fontWeight: FONT_WEIGHT[layer.font],
            lineHeight: layer.lineHeight,
            color: layer.color,
            textAlign: layer.align,
            whiteSpace: "pre",
            WebkitTextStroke: layer.stroke ? "5px #000000" : undefined,
            paintOrder: "stroke fill",
            textShadow: layer.shadow ? "0 8px 0 rgba(0,0,0,.85)" : undefined,
            background: layer.bg.enabled ? layer.bg.color : undefined,
            padding: layer.bg.enabled ? `${layer.bg.padY}px ${layer.bg.padX}px` : undefined,
            borderRadius: layer.bg.enabled ? layer.bg.radius : undefined,
          }}
        >
          {layer.text}
        </div>
      );

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
  }
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
