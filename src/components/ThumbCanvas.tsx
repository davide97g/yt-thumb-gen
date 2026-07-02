import { useState, type CSSProperties, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { CANVAS_H, CANVAS_W, FONTS, FONT_WEIGHT, drawPad, newDrawLayer, resolveBgBorder, type Action, type DrawCap, type DrawLayer, type ImageLayer, type Layer, type LayerPatch, type TextLayer, type ThumbDoc } from "../state";
import { smoothPath, type Pt } from "../lib/smoothPath";
import { ClaudeLogo, ClaudeWordmark } from "./brand";
import { EffectBackground } from "./EffectBackground";

export { CANVAS_H, CANVAS_W };

/** Which crop tool is armed for the selected image (ephemeral UI state, never in the doc). */
export type CropMode = null | "rect" | "lasso";

const SELECT_COLOR = "#4aa3ff";
const BASE_IMG_W = 360; // width at scale 1 for an uploaded photo
const LOGO_W = 120; // brand logo base width (square)
const WORDMARK_ASPECT = 426 / 125; // viewBox of the cropped "Claude" wordmark

const outlineId = (id: string) => `thumb-outline-${id}`;

/**
 * Glow: stacked drop-shadows trace the cut-out's alpha edge.
 * Line: a single SVG feMorphology dilate pass (defined in OutlineDefs) — one GPU pass instead of
 * dozens of chained shadows, which is what made the line variant choke during drags.
 */
function glowFilter(l: ImageLayer): string | undefined {
  if (!l.glow) return undefined;
  if (l.glowStyle === "line") return `url(#${outlineId(l.id)})`;
  const s = l.glowSize;
  return [s, s, Math.round(s / 2)].map((r) => `drop-shadow(0 0 ${r}px ${l.glowColor})`).join(" ");
}

/** Light/colour adjustments (applied first) chained with the glow filter. */
function imageFilter(l: ImageLayer): string | undefined {
  const adj: string[] = [];
  if ((l.brightness ?? 100) !== 100) adj.push(`brightness(${l.brightness}%)`);
  if ((l.contrast ?? 100) !== 100) adj.push(`contrast(${l.contrast}%)`);
  if ((l.saturation ?? 100) !== 100) adj.push(`saturate(${l.saturation}%)`);
  const glow = glowFilter(l);
  return [adj.join(" "), glow].filter(Boolean).join(" ") || undefined;
}

// Tileable film grain, inline so html-to-image captures it (no external asset). %23 = #, %25 = %.
const GRAIN_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

/** Global colour grade over the whole canvas — unifies disparate layers. pointer-events:none so it never blocks selection. */
function GlobalGrade({ bg }: { bg: { gradeTint?: string; gradeAmount?: number; gradeBlend?: string; gradeVignette?: number; gradeGrain?: number } }) {
  const amount = bg.gradeAmount ?? 0,
    vignette = bg.gradeVignette ?? 0,
    grain = bg.gradeGrain ?? 0;
  if (!amount && !vignette && !grain) return null;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {amount > 0 && (
        <div style={{ position: "absolute", inset: 0, background: bg.gradeTint ?? "#d97757", opacity: amount / 100, mixBlendMode: (bg.gradeBlend ?? "soft-light") as CSSProperties["mixBlendMode"] }} />
      )}
      {vignette > 0 && <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, transparent 55%, #000 135%)", opacity: vignette / 100 }} />}
      {grain > 0 && <div style={{ position: "absolute", inset: 0, backgroundImage: `url("${GRAIN_URL}")`, opacity: grain / 100, mixBlendMode: "overlay" }} />}
    </div>
  );
}

/** Full-canvas frame border — sits above layers & grade, captured on export. */
function BackgroundBorder({ border }: { border: ReturnType<typeof resolveBgBorder> }) {
  if (!border.enabled) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: border.inset,
        border: `${border.width}px ${border.style} ${border.color}`,
        borderRadius: border.radius,
        opacity: border.opacity / 100,
        pointerEvents: "none",
        boxSizing: "border-box",
      }}
    />
  );
}

/** Solid-outline filters for every line-glow image layer. Lives inside the captured node so export keeps them. */
function OutlineDefs({ layers }: { layers: Layer[] }) {
  const lines = layers.filter((l): l is ImageLayer => l.type === "image" && l.glow && l.glowStyle === "line");
  if (lines.length === 0) return null;
  return (
    <svg aria-hidden style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        {lines.map((l) => (
          // Dilate the silhouette alpha by glowSize px, flood it with the glow colour, then put the image back on top.
          <filter key={l.id} id={outlineId(l.id)} x="-50%" y="-50%" width="200%" height="200%">
            <feMorphology in="SourceAlpha" operator="dilate" radius={l.glowSize} result="d" />
            <feFlood floodColor={l.glowColor} result="c" />
            <feComposite in="c" in2="d" operator="in" result="o" />
            <feMerge>
              <feMergeNode in="o" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        ))}
      </defs>
    </svg>
  );
}

type Props = {
  doc: ThumbDoc;
  scale: number;
  selectedId: string | null;
  exporting: boolean;
  cropMode: CropMode;
  setCropMode: (m: CropMode) => void;
  drawMode: boolean;
  setDrawMode: (v: boolean) => void;
  canvasRef: RefObject<HTMLDivElement | null>;
  dispatch: Dispatch<Action>;
};

export function ThumbCanvas({ doc, scale, selectedId, exporting, cropMode, setCropMode, drawMode, setDrawMode, canvasRef, dispatch }: Props) {
  const bg = doc.background;
  const background =
    bg.mode === "image" && bg.image
      ? "#000" // image rendered as an <img> below so zoom/offset can transform it
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
      onPointerDown={() => { dispatch({ type: "select", id: null }); setCropMode(null); }}
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
      <OutlineDefs layers={doc.layers} />
      {bg.mode === "image" && bg.image && (
        <img
          src={bg.image}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `translate(${bg.imageX ?? 0}%, ${bg.imageY ?? 0}%) scale(${(bg.imageZoom ?? 100) / 100})`,
            transformOrigin: "center",
            pointerEvents: "none",
          }}
        />
      )}
      {bg.mode === "effect" && bg.effect && <EffectBackground effect={bg.effect} />}
      {bg.overlay > 0 && <div style={{ position: "absolute", inset: 0, background: "#000", opacity: bg.overlay / 100 }} />}

      {doc.layers.map((layer) => {
        if (!layer.visible) return null;
        // Crop only applies to the selected image, and never during PNG capture.
        const layerCrop = !exporting && layer.id === selectedId ? cropMode : null;
        return (
          <div
            key={layer.id}
            data-lbox
            data-layer-id={layer.id}
            onPointerDown={(e) => startDrag(e, layer.id)}
            style={{
              position: "absolute",
              left: layer.x,
              top: layer.y,
              opacity: layer.type === "image" ? (layer.opacity ?? 100) / 100 : undefined,
              transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
              cursor: "grab",
              touchAction: "none",
            }}
          >
            <LayerContent layer={layer} cropMode={layerCrop} />
            {!exporting && layer.id === selectedId && (
              <SelectionFrame
                layer={layer}
                scale={scale}
                cropMode={layerCrop}
                onCropDone={() => setCropMode(null)}
                canvasRef={canvasRef}
                dispatch={dispatch}
              />
            )}
          </div>
        );
      })}

      <GlobalGrade bg={bg} />
      <BackgroundBorder border={resolveBgBorder(bg.border)} />

      {drawMode && (
        <DrawOverlay
          scale={scale}
          canvasRef={canvasRef}
          onStroke={(points) => { if (points.length >= 2) dispatch({ type: "addLayer", layer: newDrawLayer(points) }); setDrawMode(false); }}
        />
      )}
    </div>
  );
}

/** Full-canvas capture surface shown while the draw tool is active: collects pointer
 *  positions (converted to 1280×720 space), previews a live smoothed stroke, and on
 *  release hands the raw points back to become a DrawLayer. One press = one stroke. */
function DrawOverlay({ scale, canvasRef, onStroke }: { scale: number; canvasRef: RefObject<HTMLDivElement | null>; onStroke: (points: Pt[]) => void }) {
  const [pts, setPts] = useState<Pt[]>([]);
  function start(e: ReactPointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const toCanvas = (cx: number, cy: number): Pt => ({ x: (cx - rect.left) / scale, y: (cy - rect.top) / scale });
    const buf: Pt[] = [toCanvas(e.clientX, e.clientY)];
    setPts([...buf]);
    const move = (ev: PointerEvent) => { buf.push(toCanvas(ev.clientX, ev.clientY)); setPts([...buf]); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onStroke(buf);
      setPts([]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return (
    <div onPointerDown={start} style={{ position: "absolute", inset: 0, cursor: "crosshair", touchAction: "none", zIndex: 50 }}>
      {pts.length > 1 && (
        <svg width={CANVAS_W} height={CANVAS_H} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
          <path d={smoothPath(pts, 40)} fill="none" stroke="#ff3b3b" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

/** Transform handles drawn inside the selected layer's box, so they ride along with
 *  its position and rotation for free. Corners scale the layer around its (rotation-
 *  invariant) centre; the top knob rotates it. Handles counter-scale by `scale` so
 *  they stay a constant on-screen size regardless of canvas zoom. */
function SelectionFrame({
  layer, scale, cropMode, onCropDone, canvasRef, dispatch,
}: {
  layer: Layer; scale: number; cropMode: CropMode; onCropDone: () => void;
  canvasRef: RefObject<HTMLDivElement | null>; dispatch: Dispatch<Action>;
}) {
  // In crop mode the normal scale/rotate handles are replaced by crop tooling.
  if (cropMode && layer.type === "image" && layer.src && !layer.brand) {
    return <CropFrame layer={layer} scale={scale} mode={cropMode} onDone={onCropDone} canvasRef={canvasRef} dispatch={dispatch} />;
  }

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
    else if (base.type === "draw") { fMin = 0.2 / base.scale; fMax = 6 / base.scale; }
    else if (base.type === "shape" || base.type === "effect") { fMin = Math.max(20 / base.w, 6 / base.h); fMax = Math.min(1280 / base.w, 720 / base.h); }
    else { const lo = base.type === "emoji" ? 40 : 24, hi = base.type === "emoji" ? 360 : 220; fMin = lo / base.size; fMax = hi / base.size; }
    drag((ev) => {
      const p = toCanvas(s.rect, ev.clientX, ev.clientY);
      const f = Math.min(fMax, Math.max(fMin, Math.hypot(p.x - s.cx, p.y - s.cy) / startDist));
      const nw = s.w * f, nh = s.h * f;
      const pos = { x: s.cx - nw / 2, y: s.cy - nh / 2 };
      let patch: LayerPatch;
      if (base.type === "image" || base.type === "draw") patch = { ...pos, scale: base.scale * f };
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

const MIN_CROP = 0.06; // keep at least this fraction of each dimension visible
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
type Edges = { l?: boolean; t?: boolean; r?: boolean; b?: boolean };

/** Crop tooling for an image layer, shown in place of the scale/rotate frame.
 *  `rect` drags edge/corner handles to set crop insets; `lasso` draws a freehand
 *  polygon. Both write `crop`/`mask` (non-destructive — `src` is untouched).
 *  ponytail: crop math assumes rotation ≈ 0; rotate the layer after cropping. */
function CropFrame({
  layer, scale, mode, onDone, canvasRef, dispatch,
}: {
  layer: ImageLayer; scale: number; mode: "rect" | "lasso"; onDone: () => void;
  canvasRef: RefObject<HTMLDivElement | null>; dispatch: Dispatch<Action>;
}) {
  const crop = layer.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const hsz = 12 / scale, bw = 1.5 / scale;
  const [path, setPath] = useState<{ x: number; y: number }[] | null>(null);

  function drag(move: (e: PointerEvent) => void, end?: () => void) {
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); end?.(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Rect: drag a handle, recomputing crop against a fixed image anchor so the image stays put.
  function startResize(e: ReactPointerEvent, edges: Edges) {
    e.stopPropagation();
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-lbox]");
    const canvas = canvasRef.current;
    const img = box?.querySelector("img");
    if (!box || !canvas || !img) return;
    const Wf = img.offsetWidth, Hf = img.offsetHeight; // full displayed image size, canvas units
    const rect = canvas.getBoundingClientRect();
    const start = { ...crop };
    const ax = layer.x - Wf * start.l, ay = layer.y - Hf * start.t; // image top-left on canvas — held constant
    drag((ev) => {
      const fx = ((ev.clientX - rect.left) / scale - ax) / Wf;
      const fy = ((ev.clientY - rect.top) / scale - ay) / Hf;
      const next = { ...start };
      if (edges.l) next.l = clamp(fx, 0, 1 - start.r - MIN_CROP);
      if (edges.r) next.r = clamp(1 - fx, 0, 1 - start.l - MIN_CROP);
      if (edges.t) next.t = clamp(fy, 0, 1 - start.b - MIN_CROP);
      if (edges.b) next.b = clamp(1 - fy, 0, 1 - start.t - MIN_CROP);
      dispatch({ type: "updateLayer", id: layer.id, patch: { x: ax + Wf * next.l, y: ay + Hf * next.t, crop: next } });
    });
  }

  // Lasso: sample a freehand path in kept-box fractions, then store the polygon + its bbox.
  function startLasso(e: ReactPointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-lbox]");
    const img = box?.querySelector("img");
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); // overlay == kept box
    const pts: { x: number; y: number }[] = [];
    const sample = (cx: number, cy: number) => pts.push({ x: clamp((cx - rect.left) / rect.width, 0, 1), y: clamp((cy - rect.top) / rect.height, 0, 1) });
    sample(e.clientX, e.clientY);
    setPath([...pts]);
    drag(
      (ev) => { sample(ev.clientX, ev.clientY); setPath([...pts]); },
      () => {
        setPath(null);
        if (pts.length < 3 || !img) return onDone();
        const Wf = img.offsetWidth, Hf = img.offsetHeight;
        const ax = layer.x - Wf * crop.l, ay = layer.y - Hf * crop.t; // image top-left on canvas
        const fw = 1 - crop.l - crop.r, fh = 1 - crop.t - crop.b; // map kept-box → full-image fractions
        const full = pts.map((p) => ({ x: crop.l + p.x * fw, y: crop.t + p.y * fh }));
        const xs = full.map((p) => p.x), ys = full.map((p) => p.y);
        const next = { l: Math.min(...xs), t: Math.min(...ys), r: 1 - Math.max(...xs), b: 1 - Math.max(...ys) };
        // Re-anchor x/y so the kept region stays put instead of snapping to the image's top-left.
        dispatch({ type: "updateLayer", id: layer.id, patch: { x: ax + Wf * next.l, y: ay + Hf * next.t, crop: next, mask: { points: full } } });
        onDone();
      },
    );
  }

  if (mode === "lasso") {
    return (
      <div onPointerDown={startLasso} style={{ position: "absolute", inset: 0, cursor: "crosshair", touchAction: "none" }}>
        {path && path.length > 1 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <polygon points={path.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} fill={`${SELECT_COLOR}33`} stroke={SELECT_COLOR} strokeWidth={1} />
          </svg>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, border: `${bw}px solid ${SELECT_COLOR}`, boxSizing: "border-box", pointerEvents: "none" }}>
      {([
        { x: 0, y: 0, e: { l: true, t: true }, c: "nwse-resize" },
        { x: 0.5, y: 0, e: { t: true }, c: "ns-resize" },
        { x: 1, y: 0, e: { r: true, t: true }, c: "nesw-resize" },
        { x: 1, y: 0.5, e: { r: true }, c: "ew-resize" },
        { x: 1, y: 1, e: { r: true, b: true }, c: "nwse-resize" },
        { x: 0.5, y: 1, e: { b: true }, c: "ns-resize" },
        { x: 0, y: 1, e: { l: true, b: true }, c: "nesw-resize" },
        { x: 0, y: 0.5, e: { l: true }, c: "ew-resize" },
      ] as const).map((k, i) => (
        <div
          key={i}
          onPointerDown={(e) => startResize(e, k.e)}
          style={{
            position: "absolute", left: `${k.x * 100}%`, top: `${k.y * 100}%`, width: hsz, height: hsz,
            transform: "translate(-50%,-50%)", background: "#fff", border: `${bw}px solid ${SELECT_COLOR}`,
            boxSizing: "border-box", cursor: k.c, pointerEvents: "auto", touchAction: "none",
          }}
        />
      ))}
    </div>
  );
}

function LayerContent({ layer, cropMode }: { layer: Layer; cropMode: CropMode }) {
  switch (layer.type) {
    case "text":
      return <TextContent layer={layer} />;

    case "emoji":
      return <div style={{ fontSize: layer.size, lineHeight: 1 }}>{layer.glyph}</div>;

    case "image":
      return <ImageContent layer={layer} cropMode={cropMode} />;

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

    case "draw":
      return <DrawContent layer={layer} />;
  }
}

/** End-cap marker. `markerUnits=strokeWidth` makes caps scale with the stroke; the
 *  viewBox keeps the shape independent of that scale. `auto-start-reverse` flips the
 *  start cap so it points back down the line. */
function capMarker(cap: DrawCap, id: string, color: string, isStart: boolean) {
  if (cap === "none") return null;
  const common = { id, markerUnits: "strokeWidth" as const, viewBox: "0 0 10 10", refX: 5, refY: 5, orient: isStart ? "auto-start-reverse" : "auto" };
  if (cap === "arrow") return <marker {...common} markerWidth={4} markerHeight={4} refX={8.5}><path d="M0,1 L9,5 L0,9 L2.5,5 Z" fill={color} /></marker>;
  if (cap === "dot") return <marker {...common} markerWidth={3} markerHeight={3}><circle cx={5} cy={5} r={4.2} fill={color} /></marker>;
  return <marker {...common} markerWidth={3} markerHeight={3}><path d="M4,0 L6,0 L6,10 L4,10 Z" fill={color} /></marker>; // tee
}

function DrawContent({ layer }: { layer: DrawLayer }) {
  const t = layer.thickness;
  const pad = drawPad(t, layer.startCap, layer.endCap);
  // viewBox is the raw bbox grown by `pad` on every side; the svg renders it at `scale`.
  const vw = layer.rawW + pad * 2, vh = layer.rawH + pad * 2;
  const dash = layer.lineStyle === "dashed" ? `${t * 2.5} ${t * 1.8}` : layer.lineStyle === "dotted" ? `0 ${t * 1.8}` : undefined;
  return (
    <svg
      width={vw * layer.scale}
      height={vh * layer.scale}
      viewBox={`${-pad} ${-pad} ${vw} ${vh}`}
      preserveAspectRatio="none"
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        {capMarker(layer.startCap, `cap-s-${layer.id}`, layer.color, true)}
        {capMarker(layer.endCap, `cap-e-${layer.id}`, layer.color, false)}
      </defs>
      <path
        d={smoothPath(layer.points, layer.smoothing)}
        fill="none"
        stroke={layer.color}
        strokeWidth={t}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash}
        markerStart={layer.startCap !== "none" ? `url(#cap-s-${layer.id})` : undefined}
        markerEnd={layer.endCap !== "none" ? `url(#cap-e-${layer.id})` : undefined}
      />
    </svg>
  );
}

/** Text layer, including its optional React Bits effect (gradient / shiny / glitch). */
function TextContent({ layer }: { layer: TextLayer }) {
  const fx = layer.fx;
  // gradient/shiny "fill" the glyphs via background-clip:text, so they own `background` and
  // suppress the pill. Their movement is a CSS animation (frozen to one frame on PNG export).
  const clip = fx?.kind === "gradient" || fx?.kind === "shiny";
  const style: CSSProperties = {
    display: "inline-block",
    opacity: (layer.opacity ?? 100) / 100,
    fontFamily: FONTS[layer.font],
    fontSize: layer.size,
    fontWeight: FONT_WEIGHT[layer.font],
    lineHeight: layer.lineHeight,
    color: clip ? "transparent" : layer.color,
    textAlign: layer.align,
    whiteSpace: "pre",
    WebkitTextStroke: layer.stroke ? `${layer.strokeWidth ?? 5}px ${layer.strokeColor ?? "#000000"}` : undefined,
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

function ImageContent({ layer, cropMode }: { layer: ImageLayer; cropMode: CropMode }) {
  // Natural aspect ratio (w/h), measured on load — kept out of the doc since it's derived.
  const [aspect, setAspect] = useState<number | null>(null);
  const grab = (img: HTMLImageElement) => setAspect(img.naturalWidth / img.naturalHeight);
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

  const Wf = BASE_IMG_W * layer.scale; // full displayed image width
  const ring = layer.ring ? `10px solid ${layer.ringColor}` : undefined;

  if (!layer.src) {
    return (
      <div
        style={{
          width: Wf,
          height: Wf * 1.2,
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

  // Before the aspect is known we can't size the crop box → render plain (also the
  // common uncropped path; data URLs load synchronously so this lasts one frame).
  if (!aspect) {
    return (
      <img
        src={layer.src}
        draggable={false}
        onLoad={(e) => grab(e.currentTarget)}
        style={{ display: "block", width: Wf, maxWidth: "none", height: "auto", borderRadius: layer.radius, transform: flip, border: ring, boxSizing: "border-box", filter: imageFilter(layer) }}
      />
    );
  }

  const Hf = Wf / aspect; // full displayed image height
  const c = layer.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const keptW = Wf * (1 - c.l - c.r), keptH = Hf * (1 - c.t - c.b);
  const maskCss =
    layer.mask && layer.mask.points.length >= 3
      ? `polygon(${layer.mask.points.map((p) => `${(p.x * 100).toFixed(2)}% ${(p.y * 100).toFixed(2)}%`).join(", ")})`
      : undefined;

  // The full image, positioned so the kept region sits at the box's top-left.
  // maxWidth:none defeats Tailwind preflight's `img { max-width: 100% }`, which would
  // otherwise clamp the image to the (cropped, smaller) container and wreck the offsets.
  const fullImg: CSSProperties = { display: "block", position: "absolute", left: -Wf * c.l, top: -Hf * c.t, width: Wf, maxWidth: "none", height: "auto" };
  const container: CSSProperties = { position: "relative", width: keptW, height: keptH, borderRadius: layer.radius, border: ring, boxSizing: "border-box", transform: flip, filter: imageFilter(layer) };

  if (!cropMode) {
    return (
      <div style={{ ...container, overflow: "hidden" }}>
        <img src={layer.src} draggable={false} onLoad={(e) => grab(e.currentTarget)} style={{ ...fullImg, clipPath: maskCss }} />
      </div>
    );
  }

  // Crop mode: full image shown faded (what's being cut away) with the kept region clipped bright on top.
  return (
    <div style={{ ...container, overflow: "visible" }}>
      <img src={layer.src} draggable={false} style={{ ...fullImg, opacity: 0.35, pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: keptW, height: keptH, overflow: "hidden" }}>
        <img src={layer.src} draggable={false} onLoad={(e) => grab(e.currentTarget)} style={{ ...fullImg, clipPath: maskCss }} />
      </div>
    </div>
  );
}
