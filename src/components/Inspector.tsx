import { useState, type Dispatch, type ReactNode } from "react";
import {
  AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween, Camera, ChevronDown, ChevronRight, Crop, Group, ImagePlus, Lasso, Maximize,
  RotateCcw, Scissors, Undo2, Ungroup,
} from "lucide-react";
import { alignBoxes, distributeBoxes, type AlignEdge, type Placed } from "../lib/layout";
import {
  FONT_LABELS,
  FONT_STYLE,
  FONT_WEIGHT,
  FONTS,
  defaultEffect,
  defaultBgBorder,
  defaultFx,
  resolveGlow,
  resolveRing,
  HOLO_STOPS,
  EMOJIFX_PRESETS,
  newTextLayer,
  newImageLayer,
  newBrandLayer,
  newEmojiLayer,
  newEmojiFxLayer,
  newShapeLayer,
  newEffectLayer,
  newDrawLayer,
  FORMATS,
  SIZE_LIMITS,
  type Action,
  type FormatKey,
  type DrawCap,
  type DrawLayer,
  type Background,
  type BgBorder,
  type BgBorderStyle,
  type BgEffect,
  type EffectLayer,
  type EmojiLayer,
  type EmojiFxLayer,
  type FontKey,
  type ImageLayer,
  type Layer,
  type LayerPatch,
  type ShapeLayer,
  type TextFx,
  type TextLayer,
} from "../state";
import type { CropMode } from "./ThumbCanvas";
import { removeBackground } from "../lib/bgremove";
import { loadImageFile } from "../lib/loadImageFile";
import { ColorRow, Field, Hint, Section, SelectField, SliderRow, SwitchRow, ToggleRow, UploadButton } from "./controls";
import { DuckButtonGroup } from "./ui/duck-button-group";
import { EmptyPond } from "./ui/empty-pond";
import { GlowInput, GlowTextarea } from "./ui/glow-input";
import { HudChip } from "./ui/hud-chip";
import { QuackButton } from "./ui/quack-button";
import { StickerTooltip } from "./ui/sticker-tooltip";
import { WebcamCapture } from "./WebcamCapture";

const MAX_UPLOAD = 8 * 1024 * 1024;

// The style carries the weight and slant too, or three keys onto one family would preview
// as three identical rows.
const FONT_OPTIONS = (Object.keys(FONT_LABELS) as FontKey[]).map((value) => ({
  value,
  label: FONT_LABELS[value],
  style: { fontFamily: FONTS[value], fontWeight: FONT_WEIGHT[value], fontStyle: FONT_STYLE[value] },
}));
const ALIGN_OPTIONS: { value: TextLayer["align"]; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];
const SHAPE_OPTIONS: { value: ShapeLayer["kind"]; label: string }[] = [
  { value: "rect", label: "Rectangle" },
  { value: "pill", label: "Pill" },
  { value: "bar", label: "Progress bar" },
];

type InspectorProps = {
  selected: Layer | null;
  selectedIds: string[];
  layers: Layer[];
  dispatch: Dispatch<Action>;
  onError: (msg: string) => void;
  cropMode: CropMode;
  setCropMode: (m: CropMode) => void;
  onFontPreview: (f: FontKey | null) => void;
  cw: number; // live canvas size (per-doc format)
  ch: number;
};

/** Measure a selected layer's rendered box (canvas units) straight from the DOM.
 *
 *  Tracked text is measured **without its trailing gap**: CSS `letter-spacing`
 *  adds its space after *every* character, the last one included, so a layer set
 *  in 0.3em tracking is one whole space wider than the ink you see. Centring two
 *  such layers by their raw boxes lines up their trailing air instead of their
 *  glyphs, and the smaller one visibly sits left. Left edges are untouched, so
 *  only the width shrinks. */
function placedOf(id: string, layers: Layer[]): Placed | null {
  const el = document.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);
  const l = layers.find((x) => x.id === id);
  if (!el || !l) return null;
  const trail = l.type === "text" && l.tracking ? l.tracking * l.size : 0;
  return { id, box: { x: l.x, y: l.y, w: Math.max(1, el.offsetWidth - trail), h: el.offsetHeight } };
}

function AlignSection({ selectedIds, layers, dispatch }: { selectedIds: string[]; layers: Layer[]; dispatch: Dispatch<Action> }) {
  if (selectedIds.length < 2) return null;
  const placed = () => selectedIds.map((id) => placedOf(id, layers)).filter((p): p is Placed => p !== null);
  const align = (edge: AlignEdge) => dispatch({ type: "setPositions", positions: alignBoxes(placed(), edge) });
  const distribute = (axis: "h" | "v") => dispatch({ type: "setPositions", positions: distributeBoxes(placed(), axis) });
  const hasGroup = selectedIds.some((id) => layers.find((l) => l.id === id)?.groupId);
  const canDistribute = selectedIds.length >= 3;

  // Icon-only clusters past about four controls: duck's toolbar shape, so the six
  // alignments are one tab stop with arrow keys inside rather than six stops.
  return (
    <Section title={`Align · ${selectedIds.length} layers`}>
      <div className="space-y-1.5">
        <DuckButtonGroup toolbar aria-label="Align the selection" className="w-full [&>*]:flex-1">
          <IconChip label="Align left" onClick={() => align("left")}><AlignHorizontalJustifyStart /></IconChip>
          <IconChip label="Center horizontally" onClick={() => align("hcenter")}><AlignHorizontalJustifyCenter /></IconChip>
          <IconChip label="Align right" onClick={() => align("right")}><AlignHorizontalJustifyEnd /></IconChip>
          <IconChip label="Align top" onClick={() => align("top")}><AlignVerticalJustifyStart /></IconChip>
          <IconChip label="Center vertically" onClick={() => align("vcenter")}><AlignVerticalJustifyCenter /></IconChip>
          <IconChip label="Align bottom" onClick={() => align("bottom")}><AlignVerticalJustifyEnd /></IconChip>
        </DuckButtonGroup>
        <DuckButtonGroup toolbar aria-label="Distribute and group the selection" className="w-full [&>*]:flex-1">
          <IconChip label="Distribute horizontally" disabled={!canDistribute} onClick={() => distribute("h")}><AlignHorizontalSpaceBetween /></IconChip>
          <IconChip label="Distribute vertically" disabled={!canDistribute} onClick={() => distribute("v")}><AlignVerticalSpaceBetween /></IconChip>
          <IconChip label="Group (⌘G)" onClick={() => dispatch({ type: "group", ids: selectedIds })}><Group /></IconChip>
          <IconChip label="Ungroup (⌘⇧G)" disabled={!hasGroup} onClick={() => dispatch({ type: "ungroup", ids: selectedIds })}><Ungroup /></IconChip>
        </DuckButtonGroup>
        <Hint>Aligns to the first layer you selected — it stays put, the rest move to it.</Hint>
      </div>
    </Section>
  );
}

/** One segment of an icon toolbar: a HudChip, named by a tooltip so an icon-only
    control still says what it does to a pointer as well as to a reader. */
function IconChip({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <StickerTooltip content={label} delay={400}>
      <HudChip size="sm" aria-label={label} disabled={disabled} onClick={onClick} className="h-8 justify-center px-0 [&_svg]:size-4">
        {children}
      </HudChip>
    </StickerTooltip>
  );
}

export function Inspector({ selected, selectedIds, layers, dispatch, onError, cropMode, setCropMode, onFontPreview, cw, ch }: InspectorProps) {
  if (!selected) {
    return (
      <Section title="Properties">
        <EmptyPond compact title="Nothing selected" hint="Pick a layer on the canvas or in the list to edit it." />
      </Section>
    );
  }
  const set = (patch: LayerPatch) => dispatch({ type: "updateLayer", id: selected.id, patch });
  return (
    <>
      <AlignSection selectedIds={selectedIds} layers={layers} dispatch={dispatch} />
      <Section title={`Properties — ${selected.name}`}>
        <Field label="Name">
          <GlowInput value={selected.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        {selected.type === "text" && <TextProps layer={selected} set={set} onFontPreview={onFontPreview} />}
        {selected.type === "image" && <ImageProps layer={selected} set={set} onError={onError} cropMode={cropMode} setCropMode={setCropMode} />}
        {selected.type === "emoji" && <EmojiProps layer={selected} set={set} />}
        {selected.type === "emojifx" && <EmojiFxProps layer={selected} set={set} layers={layers} />}
        {selected.type === "shape" && <ShapeProps layer={selected} set={set} />}
        {selected.type === "effect" && <EffectProps layer={selected} set={set} cw={cw} ch={ch} />}
        {selected.type === "draw" && <DrawProps layer={selected} set={set} />}
      </Section>
    </>
  );
}

type Setter = (patch: LayerPatch) => void;

function TextProps({ layer, set, onFontPreview }: { layer: TextLayer; set: Setter; onFontPreview: (f: FontKey | null) => void }) {
  const D = newTextLayer(); // factory defaults = the "reset" targets
  return (
    <>
      <Field label="Text">
        <GlowTextarea rows={2} value={layer.text} onChange={(e) => set({ text: e.target.value })} />
      </Field>
      <SelectField label="Font" value={layer.font} options={FONT_OPTIONS} onChange={(font) => set({ font })} onPreview={onFontPreview} />
      <SliderRow label="Size" min={SIZE_LIMITS.textSize[0]} max={SIZE_LIMITS.textSize[1]} curve="log" value={layer.size} defaultValue={D.size} onChange={(size) => set({ size })} />
      <ColorRow label="Color" value={layer.color} defaultValue={D.color} onChange={(color) => set({ color })} />
      <ToggleRow label="Alignment" value={layer.align} options={ALIGN_OPTIONS} onChange={(align) => set({ align })} />
      <SliderRow label="Line height" min={0.8} max={2} step={0.05} value={layer.lineHeight} defaultValue={D.lineHeight} display={layer.lineHeight.toFixed(2)} onChange={(lineHeight) => set({ lineHeight })} />
      <SliderRow label="Tracking" min={-0.05} max={0.6} step={0.01} value={layer.tracking ?? 0} defaultValue={D.tracking} display={`${(layer.tracking ?? 0).toFixed(2)}em`} onChange={(tracking) => set({ tracking })} />
      <SliderRow label="Rotation" min={-180} max={180} value={layer.rotation} defaultValue={D.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
      <SliderRow label="Opacity" min={0} max={100} value={layer.opacity ?? 100} defaultValue={D.opacity} display={`${layer.opacity ?? 100}%`} onChange={(opacity) => set({ opacity })} />
      <SwitchRow label="Outline" checked={layer.stroke} defaultValue={D.stroke} onChange={(stroke) => set({ stroke })} />
      {layer.stroke && (
        <>
          <ColorRow label="Outline color" value={layer.strokeColor ?? "#000000"} defaultValue={D.strokeColor} onChange={(strokeColor) => set({ strokeColor })} />
          <SliderRow label="Outline width" min={1} max={40} value={layer.strokeWidth ?? 5} defaultValue={D.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} />
        </>
      )}
      <SwitchRow label="Shadow" checked={layer.shadow} defaultValue={D.shadow} onChange={(shadow) => set({ shadow })} />
      <SwitchRow label="Pill background" checked={layer.bg.enabled} defaultValue={D.bg.enabled} onChange={(enabled) => set({ bg: { ...layer.bg, enabled } })} />
      {layer.bg.enabled && (
        <>
          <ColorRow label="Pill color" value={layer.bg.color} defaultValue={D.bg.color} onChange={(color) => set({ bg: { ...layer.bg, color } })} />
          <SliderRow label="H padding" min={0} max={80} value={layer.bg.padX} defaultValue={D.bg.padX} onChange={(padX) => set({ bg: { ...layer.bg, padX } })} />
          <SliderRow label="V padding" min={0} max={60} value={layer.bg.padY} defaultValue={D.bg.padY} onChange={(padY) => set({ bg: { ...layer.bg, padY } })} />
          <SliderRow label="Corner radius" min={0} max={999} value={layer.bg.radius} defaultValue={D.bg.radius} onChange={(radius) => set({ bg: { ...layer.bg, radius } })} />
        </>
      )}
      <SelectField
        label="Effect"
        value={layer.fx?.kind ?? "none"}
        options={TEXT_FX_OPTIONS}
        onChange={(kind) => set({ fx: defaultFx(kind) })}
      />
      {layer.fx && layer.fx.kind !== "none" && <TextFxControls fx={layer.fx} set={set} />}
    </>
  );
}

const TEXT_FX_OPTIONS: { value: TextFx["kind"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "gradient", label: "Gradient" },
  { value: "shiny", label: "Shiny" },
  { value: "glitch", label: "Glitch" },
];

const GRAD_DIR_OPTIONS: { value: "horizontal" | "vertical" | "diagonal"; label: string }[] = [
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
  { value: "diagonal", label: "Diagonal" },
];

const SHINY_DIR_OPTIONS: { value: "left" | "right"; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

function TextFxControls({ fx, set }: { fx: TextFx; set: Setter }) {
  const upd = (patch: Record<string, unknown>) => set({ fx: { ...fx, ...patch } as TextFx });
  switch (fx.kind) {
    case "gradient": {
      const D = defaultFx("gradient") as typeof fx;
      const setColor = (i: number, v: string) => {
        const colors = [...fx.colors] as [string, string, string];
        colors[i] = v;
        upd({ colors });
      };
      return (
        <>
          <ColorRow label="Color 1" value={fx.colors[0]} defaultValue={D.colors[0]} onChange={(v) => setColor(0, v)} />
          <ColorRow label="Color 2" value={fx.colors[1]} defaultValue={D.colors[1]} onChange={(v) => setColor(1, v)} />
          <ColorRow label="Color 3" value={fx.colors[2]} defaultValue={D.colors[2]} onChange={(v) => setColor(2, v)} />
          <SelectField label="Direction" value={fx.direction} options={GRAD_DIR_OPTIONS} onChange={(direction) => upd({ direction })} />
          <SliderRow label="Speed" min={1} max={20} value={fx.speed} defaultValue={D.speed} display={`${fx.speed}s`} onChange={(speed) => upd({ speed })} />
        </>
      );
    }
    case "shiny": {
      const D = defaultFx("shiny") as typeof fx;
      return (
        <>
          <ColorRow label="Color" value={fx.color} defaultValue={D.color} onChange={(color) => upd({ color })} />
          <ColorRow label="Shine" value={fx.shineColor} defaultValue={D.shineColor} onChange={(shineColor) => upd({ shineColor })} />
          <SliderRow label="Spread" min={0} max={360} value={fx.spread} defaultValue={D.spread} display={`${fx.spread}°`} onChange={(spread) => upd({ spread })} />
          <SelectField label="Direction" value={fx.direction} options={SHINY_DIR_OPTIONS} onChange={(direction) => upd({ direction })} />
          <SliderRow label="Speed" min={0.5} max={8} step={0.5} value={fx.speed} defaultValue={D.speed} display={`${fx.speed}s`} onChange={(speed) => upd({ speed })} />
        </>
      );
    }
    case "glitch": {
      const D = defaultFx("glitch") as typeof fx;
      return (
        <>
          <ColorRow label="Color 1" value={fx.color1} defaultValue={D.color1} onChange={(color1) => upd({ color1 })} />
          <ColorRow label="Color 2" value={fx.color2} defaultValue={D.color2} onChange={(color2) => upd({ color2 })} />
          <SliderRow label="Speed" min={0.2} max={5} step={0.1} value={fx.speed} defaultValue={D.speed} display={`${fx.speed.toFixed(1)}×`} onChange={(speed) => upd({ speed })} />
          <SwitchRow label="Shadows" checked={fx.enableShadows} defaultValue={D.enableShadows} onChange={(enableShadows) => upd({ enableShadows })} />
        </>
      );
    }
    default:
      return null;
  }
}

/** Clear the crop, putting the full image back where it sat before cropping (the visible
 *  region stays put, the rest grows back around it) by reading the rendered image size. */
function restoreCrop(layer: ImageLayer, set: Setter) {
  const img = document.querySelector<HTMLImageElement>(`[data-layer-id="${layer.id}"] img`);
  const c = layer.crop;
  if (img && c) {
    set({ x: layer.x - img.offsetWidth * c.l, y: layer.y - img.offsetHeight * c.t, crop: undefined, mask: undefined });
  } else {
    set({ crop: undefined, mask: undefined });
  }
}

const RING_STYLE_OPTIONS: { value: "solid" | "gradient"; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "gradient", label: "Gradient" },
];

/** Border controls for an image layer. The gradient stops live behind the "Gradient" style so
 *  the common solid border stays a two-row affair. */
function ImageRingControls({ layer, set }: { layer: ImageLayer; set: Setter }) {
  const r = resolveRing(layer);
  const setStop = (i: number, v: string) => {
    const ringColors = [...r.colors] as [string, string, string, string];
    ringColors[i] = v;
    set({ ringColors });
  };
  return (
    <>
      <SelectField label="Border style" value={r.style} options={RING_STYLE_OPTIONS} onChange={(ringStyle) => set({ ringStyle })} />
      {r.style === "solid" ? (
        <ColorRow label="Border color" value={layer.ringColor} defaultValue={newImageLayer().ringColor} onChange={(ringColor) => set({ ringColor })} />
      ) : (
        <>
          {r.colors.map((c, i) => (
            <ColorRow key={i} label={`Color ${i + 1}`} value={c} defaultValue={HOLO_STOPS[i]} onChange={(v) => setStop(i, v)} />
          ))}
          <SliderRow label="Angle" min={0} max={360} value={r.angle} defaultValue={135} display={`${r.angle}°`} onChange={(ringAngle) => set({ ringAngle })} />
        </>
      )}
      <SliderRow label="Border width" min={1} max={60} value={r.width} defaultValue={10} onChange={(ringWidth) => set({ ringWidth })} />
      <SliderRow label="Border glow" min={0} max={60} value={r.glow} defaultValue={0} display={r.glow ? `${r.glow}px` : "off"} onChange={(ringGlow) => set({ ringGlow })} />
    </>
  );
}

/** Stops + angle of the gradient traced around the cut-out. Split from the halo rows because they
 *  straddle the shared width slider, which reads as "outline thickness" for every style. */
function ImageGlowGradientControls({ layer, set }: { layer: ImageLayer; set: Setter }) {
  const g = resolveGlow(layer);
  const setStop = (i: number, v: string) => {
    const glowColors = [...g.colors] as [string, string, string, string];
    glowColors[i] = v;
    set({ glowColors });
  };
  return (
    <>
      {g.colors.map((c, i) => (
        <ColorRow key={i} label={`Color ${i + 1}`} value={c} defaultValue={HOLO_STOPS[i]} onChange={(v) => setStop(i, v)} />
      ))}
      <SliderRow label="Angle" min={0} max={360} value={g.angle} defaultValue={135} display={`${g.angle}°`} onChange={(glowAngle) => set({ glowAngle })} />
    </>
  );
}

function ImageGlowHaloControls({ layer, set }: { layer: ImageLayer; set: Setter }) {
  const g = resolveGlow(layer);
  return (
    <>
      <SliderRow label="Halo" min={0} max={80} value={g.halo} defaultValue={18} display={g.halo ? `${g.halo}px` : "off"} onChange={(glowHalo) => set({ glowHalo })} />
      {g.halo > 0 && (
        <SliderRow label="Halo opacity" min={0} max={100} value={g.haloOpacity} defaultValue={70} display={`${g.haloOpacity}%`} onChange={(glowHaloOpacity) => set({ glowHaloOpacity })} />
      )}
    </>
  );
}

function ImageProps({ layer, set, onError, cropMode, setCropMode }: { layer: ImageLayer; set: Setter; onError: (msg: string) => void; cropMode: CropMode; setCropMode: (m: CropMode) => void }) {
  const [busy, setBusy] = useState(false);
  const [showCam, setShowCam] = useState(false);

  async function onUpload(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD) return onError("Image too large (max 8 MB)");
    try {
      onError("");
      set({ src: await loadImageFile(file), origSrc: null, brand: null });
    } catch {
      onError("Couldn't read the image.");
    }
  }

  async function onRemoveBg() {
    if (!layer.src || busy) return;
    setBusy(true);
    onError("");
    try {
      const cutout = await removeBackground(layer.src);
      set({ origSrc: layer.origSrc ?? layer.src, src: cutout, glow: true });
    } catch {
      onError(
        import.meta.env.DEV
          ? "Background-removal service unreachable — start ./bgremove (port 8000)."
          : "Background removal failed — try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const D = layer.brand ? newBrandLayer(layer.brand) : newImageLayer();
  return (
    <>
      {layer.brand ? (
        <ColorRow label="Mark color" value={layer.brandColor} defaultValue={D.brandColor} onChange={(brandColor) => set({ brandColor })} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <UploadButton label={layer.src ? "Replace" : "From file"} icon={<ImagePlus />} onFile={(f) => void onUpload(f)} />
          <QuackButton variant="outline" size="sm" onClick={() => setShowCam(true)}>
            <Camera /> Camera
          </QuackButton>
          {layer.src && (
            <>
              {/* The cutout is a request that can be in flight, so the button says so
                  itself through `state` instead of rewriting its own label. */}
              <QuackButton
                variant="outline"
                size="sm"
                state={busy ? "loading" : "idle"}
                loadingLabel="Removing…"
                onClick={onRemoveBg}
              >
                <Scissors /> Remove background
              </QuackButton>
              {layer.origSrc && (
                <QuackButton variant="outline" size="sm" onClick={() => set({ src: layer.origSrc, origSrc: null })}>
                  <Undo2 /> Restore
                </QuackButton>
              )}
              {/* Crop and lasso are modes, not actions: a chip that stays lit while the
                  mode is on, which is exactly what HudChip's `active` is for. */}
              <HudChip size="sm" className="h-8 justify-center" active={cropMode === "rect"} onClick={() => setCropMode(cropMode === "rect" ? null : "rect")}>
                <Crop /> Crop
              </HudChip>
              <HudChip size="sm" className="h-8 justify-center" active={cropMode === "lasso"} onClick={() => setCropMode(cropMode === "lasso" ? null : "lasso")}>
                <Lasso /> Lasso
              </HudChip>
              {(layer.crop || layer.mask) && (
                <QuackButton variant="outline" size="sm" className="col-span-2" onClick={() => { restoreCrop(layer, set); setCropMode(null); }}>
                  <Undo2 /> Reset crop
                </QuackButton>
              )}
              <QuackButton variant="ghost" size="sm" className="col-span-2 text-muted-foreground" onClick={() => set({ src: null, origSrc: null })}>
                <RotateCcw /> Remove photo
              </QuackButton>
            </>
          )}
        </div>
      )}
      <SliderRow label="Scale" min={SIZE_LIMITS.imageScale[0]} max={SIZE_LIMITS.imageScale[1]} step={0.01} curve="log" value={layer.scale} defaultValue={D.scale} display={layer.scale.toFixed(2)} onChange={(scale) => set({ scale })} />
      <SliderRow label="Rotation" min={-180} max={180} value={layer.rotation} defaultValue={D.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
      <SliderRow label="Opacity" min={0} max={100} value={layer.opacity ?? 100} defaultValue={D.opacity} display={`${layer.opacity ?? 100}%`} onChange={(opacity) => set({ opacity })} />
      {!layer.brand && layer.src && (
        <>
          <SliderRow label="Brightness" min={0} max={200} value={layer.brightness ?? 100} defaultValue={100} display={`${layer.brightness ?? 100}%`} onChange={(brightness) => set({ brightness })} />
          <SliderRow label="Contrast" min={0} max={200} value={layer.contrast ?? 100} defaultValue={100} display={`${layer.contrast ?? 100}%`} onChange={(contrast) => set({ contrast })} />
          <SliderRow label="Saturation" min={0} max={200} value={layer.saturation ?? 100} defaultValue={100} display={`${layer.saturation ?? 100}%`} onChange={(saturation) => set({ saturation })} />
        </>
      )}
      {!layer.brand && (
        <>
          <SliderRow label="Corner radius" min={0} max={220} value={layer.radius} defaultValue={D.radius} onChange={(radius) => set({ radius })} />
          <SwitchRow label="Border" checked={layer.ring} defaultValue={D.ring} onChange={(ring) => set({ ring })} />
          {layer.ring && <ImageRingControls layer={layer} set={set} />}
        </>
      )}
      <SwitchRow label="Mirror" checked={layer.flip} defaultValue={D.flip} onChange={(flip) => set({ flip })} />
      {!layer.brand && (
        <>
          <SwitchRow label="Glow" checked={layer.glow} defaultValue={D.glow} onChange={(glow) => set({ glow })} />
          {layer.glow && (
            <>
              <SelectField
                label="Glow style"
                value={layer.glowStyle}
                options={[
                  { value: "glow", label: "Soft" },
                  { value: "line", label: "Hard line" },
                  { value: "gradient", label: "Gradient" },
                ]}
                onChange={(glowStyle) => set({ glowStyle })}
              />
              {layer.glowStyle === "gradient" ? (
                <ImageGlowGradientControls layer={layer} set={set} />
              ) : (
                <ColorRow label="Glow color" value={layer.glowColor} defaultValue={D.glowColor} onChange={(glowColor) => set({ glowColor })} />
              )}
              <SliderRow label={layer.glowStyle === "glow" ? "Strength" : "Width"} min={1} max={48} value={layer.glowSize} defaultValue={D.glowSize} onChange={(glowSize) => set({ glowSize })} />
              {layer.glowStyle === "gradient" && <ImageGlowHaloControls layer={layer} set={set} />}
            </>
          )}
        </>
      )}
      {showCam && <WebcamCapture onCapture={(src) => set({ src, origSrc: null, brand: null })} onClose={() => setShowCam(false)} />}
    </>
  );
}

function EmojiProps({ layer, set }: { layer: EmojiLayer; set: Setter }) {
  const D = newEmojiLayer();
  return (
    <>
      <Field label="Emoji">
        <GlowInput value={layer.glyph} onChange={(e) => set({ glyph: e.target.value })} />
      </Field>
      <SliderRow label="Size" min={SIZE_LIMITS.emojiSize[0]} max={SIZE_LIMITS.emojiSize[1]} curve="log" value={layer.size} defaultValue={D.size} onChange={(size) => set({ size })} />
      <SliderRow label="Rotation" min={-180} max={180} value={layer.rotation} defaultValue={D.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
    </>
  );
}

const EMOJIFX_PATTERN_OPTIONS: { value: EmojiFxLayer["pattern"]; label: string }[] = [
  { value: "ring", label: "3D ring" },
  { value: "scatter", label: "Scattered" },
  { value: "burst", label: "Burst" },
];

function EmojiFxProps({ layer, set, layers }: { layer: EmojiFxLayer; set: Setter; layers: Layer[] }) {
  const D = newEmojiFxLayer();
  const imageOptions = [
    { value: "", label: "None (centered)" },
    ...layers.filter((l) => l.type === "image").map((l) => ({ value: l.id, label: l.name })),
  ];
  return (
    <>
      <SelectField
        label="Image"
        value={layer.targetId ?? ""}
        options={imageOptions}
        onChange={(id) => set({ targetId: id === "" ? null : id })}
      />
      <SelectField label="Pattern" value={layer.pattern} options={EMOJIFX_PATTERN_OPTIONS} onChange={(pattern) => set({ pattern })} />
      <Field label="Emoji">
        {/* ponytail: space-separated glyphs — avoids grapheme-cluster splitting; presets below fill it. */}
        <GlowInput value={layer.glyphs.join(" ")} onChange={(e) => set({ glyphs: e.target.value.split(/\s+/).filter(Boolean) })} />
      </Field>
      <div className="flex flex-wrap gap-1">
        {EMOJIFX_PRESETS.map((p) => (
          <HudChip key={p.label} size="sm" onClick={() => set({ glyphs: [...p.glyphs] })}>
            {p.label}
          </HudChip>
        ))}
      </div>
      <SliderRow label="Count" min={3} max={80} value={layer.count} defaultValue={D.count} onChange={(count) => set({ count })} />
      <SliderRow label="Size" min={SIZE_LIMITS.emojiFxSize[0]} max={SIZE_LIMITS.emojiFxSize[1]} curve="log" value={layer.size} defaultValue={D.size} onChange={(size) => set({ size })} />
      <SliderRow label="Variance" min={0} max={100} value={layer.sizeJitter} defaultValue={D.sizeJitter} display={`${layer.sizeJitter}%`} onChange={(sizeJitter) => set({ sizeJitter })} />
      <SliderRow label="Radius" min={80} max={640} value={layer.radius} defaultValue={D.radius} onChange={(radius) => set({ radius })} />
      {layer.pattern === "ring" && (
        <SliderRow label="Tilt" min={5} max={100} value={Math.round(layer.tilt * 100)} defaultValue={Math.round(D.tilt * 100)} display={`${Math.round(layer.tilt * 100)}%`} onChange={(v) => set({ tilt: v / 100 })} />
      )}
      <SliderRow label="Depth" min={0} max={100} value={layer.depth} defaultValue={D.depth} display={`${layer.depth}%`} onChange={(depth) => set({ depth })} />
      <SliderRow label="Random spin" min={0} max={100} value={layer.spin} defaultValue={D.spin} display={`${layer.spin}%`} onChange={(spin) => set({ spin })} />
      <QuackButton variant="outline" size="sm" onClick={() => set({ seed: Math.floor(Math.random() * 1e9) })}>
        Shuffle
      </QuackButton>
    </>
  );
}

function ShapeProps({ layer, set }: { layer: ShapeLayer; set: Setter }) {
  const D = newShapeLayer(layer.kind);
  return (
    <>
      <SelectField label="Type" value={layer.kind} options={SHAPE_OPTIONS} onChange={(kind) => set({ kind })} />
      <ColorRow label="Color" value={layer.fill} defaultValue={D.fill} onChange={(fill) => set({ fill })} />
      <SliderRow label="Width" min={SIZE_LIMITS.boxW[0]} max={SIZE_LIMITS.boxW[1]} curve="log" value={layer.w} defaultValue={D.w} onChange={(w) => set({ w })} />
      <SliderRow label="Height" min={SIZE_LIMITS.boxH[0]} max={SIZE_LIMITS.boxH[1]} curve="log" value={layer.h} defaultValue={D.h} onChange={(h) => set({ h })} />
      {layer.kind === "rect" && <SliderRow label="Corner radius" min={0} max={220} value={layer.radius} defaultValue={D.radius} onChange={(radius) => set({ radius })} />}
      <SliderRow label="Rotation" min={-180} max={180} value={layer.rotation} defaultValue={D.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
      {layer.kind === "bar" && (
        <>
          <SliderRow label="Watched" min={0} max={100} value={layer.pct} defaultValue={D.pct} display={`${layer.pct}%`} onChange={(pct) => set({ pct })} />
          <ColorRow label="Track color" value={layer.trackColor} defaultValue={D.trackColor} onChange={(trackColor) => set({ trackColor })} />
        </>
      )}
    </>
  );
}

const LINE_STYLE_OPTIONS: { value: DrawLayer["lineStyle"]; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];
const DRAW_CAP_OPTIONS: { value: DrawCap; label: string }[] = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "dot", label: "Dot" },
  { value: "tee", label: "Bar" },
];

function DrawProps({ layer, set }: { layer: DrawLayer; set: Setter }) {
  const D = newDrawLayer([]); // style defaults; geometry args irrelevant for the reset targets
  return (
    <>
      <ColorRow label="Color" value={layer.color} defaultValue={D.color} onChange={(color) => set({ color })} />
      <SliderRow label="Thickness" min={1} max={60} value={layer.thickness} defaultValue={D.thickness} onChange={(thickness) => set({ thickness })} />
      <SelectField label="Line style" value={layer.lineStyle} options={LINE_STYLE_OPTIONS} onChange={(lineStyle) => set({ lineStyle })} />
      <SliderRow label="Smoothing" min={0} max={100} value={layer.smoothing} defaultValue={D.smoothing} display={`${layer.smoothing}%`} onChange={(smoothing) => set({ smoothing })} />
      <SelectField label="Start cap" value={layer.startCap} options={DRAW_CAP_OPTIONS} onChange={(startCap) => set({ startCap })} />
      <SelectField label="End cap" value={layer.endCap} options={DRAW_CAP_OPTIONS} onChange={(endCap) => set({ endCap })} />
      <SliderRow label="Rotation" min={-180} max={180} value={layer.rotation} defaultValue={D.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
    </>
  );
}

// ── Background ────────────────────────────────────────────────────────────────

const BG_MODE_OPTIONS: { value: "solid" | "gradient" | "effect" | "transparent"; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "gradient", label: "Gradient" },
  { value: "effect", label: "Effect" },
  { value: "transparent", label: "Transparent" },
];

const BG_PRESET_OPTIONS: { value: BgEffect["preset"]; label: string }[] = [
  { value: "grainient", label: "Grainient" },
  { value: "aurora", label: "Aurora" },
  { value: "mesh", label: "Mesh" },
  { value: "dots", label: "Dots" },
];

type Upd = (patch: Record<string, number | string | boolean>) => void;

function DisclosureRow({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 pt-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5"
    >
      {open ? <ChevronDown /> : <ChevronRight />}
      {label}
    </button>
  );
}

function GrainientControls({ e, upd }: { e: Extract<BgEffect, { preset: "grainient" }>; upd: Upd }) {
  const [adv, setAdv] = useState(false);
  const D = defaultEffect("grainient") as typeof e;
  return (
    <>
      <ColorRow label="Color 1" value={e.color1} defaultValue={D.color1} onChange={(color1) => upd({ color1 })} />
      <ColorRow label="Color 2" value={e.color2} defaultValue={D.color2} onChange={(color2) => upd({ color2 })} />
      <ColorRow label="Color 3" value={e.color3} defaultValue={D.color3} onChange={(color3) => upd({ color3 })} />
      <SliderRow label="Speed" min={0} max={2} step={0.05} value={e.timeSpeed} defaultValue={D.timeSpeed} display={e.timeSpeed.toFixed(2)} onChange={(timeSpeed) => upd({ timeSpeed })} />
      <SliderRow label="Color balance" min={-1} max={1} step={0.01} value={e.colorBalance} defaultValue={D.colorBalance} display={e.colorBalance.toFixed(2)} onChange={(colorBalance) => upd({ colorBalance })} />
      <SliderRow label="Warp strength" min={0} max={3} step={0.05} value={e.warpStrength} defaultValue={D.warpStrength} display={e.warpStrength.toFixed(2)} onChange={(warpStrength) => upd({ warpStrength })} />
      <SliderRow label="Warp frequency" min={0} max={20} step={0.1} value={e.warpFrequency} defaultValue={D.warpFrequency} display={e.warpFrequency.toFixed(1)} onChange={(warpFrequency) => upd({ warpFrequency })} />
      <SliderRow label="Warp speed" min={0} max={10} step={0.1} value={e.warpSpeed} defaultValue={D.warpSpeed} display={e.warpSpeed.toFixed(1)} onChange={(warpSpeed) => upd({ warpSpeed })} />
      <SliderRow label="Warp amplitude" min={1} max={200} value={e.warpAmplitude} defaultValue={D.warpAmplitude} onChange={(warpAmplitude) => upd({ warpAmplitude })} />
      <SliderRow label="Blend angle" min={-180} max={180} value={e.blendAngle} defaultValue={D.blendAngle} display={`${e.blendAngle}°`} onChange={(blendAngle) => upd({ blendAngle })} />
      <SliderRow label="Blend softness" min={0} max={1} step={0.01} value={e.blendSoftness} defaultValue={D.blendSoftness} display={e.blendSoftness.toFixed(2)} onChange={(blendSoftness) => upd({ blendSoftness })} />
      <SliderRow label="Grain amount" min={0} max={1} step={0.01} value={e.grainAmount} defaultValue={D.grainAmount} display={e.grainAmount.toFixed(2)} onChange={(grainAmount) => upd({ grainAmount })} />
      <SliderRow label="Grain scale" min={0} max={10} step={0.1} value={e.grainScale} defaultValue={D.grainScale} display={e.grainScale.toFixed(1)} onChange={(grainScale) => upd({ grainScale })} />
      <SwitchRow label="Animated grain" checked={e.grainAnimated} defaultValue={D.grainAnimated} onChange={(grainAnimated) => upd({ grainAnimated })} />
      <SliderRow label="Contrast" min={0} max={3} step={0.05} value={e.contrast} defaultValue={D.contrast} display={e.contrast.toFixed(2)} onChange={(contrast) => upd({ contrast })} />
      <SliderRow label="Saturation" min={0} max={2} step={0.05} value={e.saturation} defaultValue={D.saturation} display={e.saturation.toFixed(2)} onChange={(saturation) => upd({ saturation })} />
      <DisclosureRow open={adv} onToggle={() => setAdv((v) => !v)} label="Advanced" />
      {adv && (
        <>
          <SliderRow label="Rotation" min={0} max={1000} step={10} value={e.rotationAmount} defaultValue={D.rotationAmount} onChange={(rotationAmount) => upd({ rotationAmount })} />
          <SliderRow label="Noise scale" min={0} max={10} step={0.1} value={e.noiseScale} defaultValue={D.noiseScale} display={e.noiseScale.toFixed(1)} onChange={(noiseScale) => upd({ noiseScale })} />
          <SliderRow label="Gamma" min={0.1} max={3} step={0.05} value={e.gamma} defaultValue={D.gamma} display={e.gamma.toFixed(2)} onChange={(gamma) => upd({ gamma })} />
          <SliderRow label="Center X" min={-1} max={1} step={0.01} value={e.centerX} defaultValue={D.centerX} display={e.centerX.toFixed(2)} onChange={(centerX) => upd({ centerX })} />
          <SliderRow label="Center Y" min={-1} max={1} step={0.01} value={e.centerY} defaultValue={D.centerY} display={e.centerY.toFixed(2)} onChange={(centerY) => upd({ centerY })} />
          <SliderRow label="Zoom" min={0.1} max={3} step={0.05} value={e.zoom} defaultValue={D.zoom} display={e.zoom.toFixed(2)} onChange={(zoom) => upd({ zoom })} />
        </>
      )}
    </>
  );
}

function AuroraControls({ e, upd }: { e: Extract<BgEffect, { preset: "aurora" }>; upd: Upd }) {
  const D = defaultEffect("aurora") as typeof e;
  return (
    <>
      <ColorRow label="Color 1" value={e.color1} defaultValue={D.color1} onChange={(color1) => upd({ color1 })} />
      <ColorRow label="Color 2" value={e.color2} defaultValue={D.color2} onChange={(color2) => upd({ color2 })} />
      <ColorRow label="Color 3" value={e.color3} defaultValue={D.color3} onChange={(color3) => upd({ color3 })} />
      <SliderRow label="Speed" min={0} max={3} step={0.05} value={e.speed} defaultValue={D.speed} display={e.speed.toFixed(2)} onChange={(speed) => upd({ speed })} />
      <SliderRow label="Blend" min={0} max={1} step={0.01} value={e.blend} defaultValue={D.blend} display={e.blend.toFixed(2)} onChange={(blend) => upd({ blend })} />
      <SliderRow label="Amplitude" min={0} max={3} step={0.05} value={e.amplitude} defaultValue={D.amplitude} display={e.amplitude.toFixed(2)} onChange={(amplitude) => upd({ amplitude })} />
    </>
  );
}

function MeshControls({ e, upd }: { e: Extract<BgEffect, { preset: "mesh" }>; upd: Upd }) {
  const D = defaultEffect("mesh") as typeof e;
  return (
    <>
      <ColorRow label="Color 1" value={e.color1} defaultValue={D.color1} onChange={(color1) => upd({ color1 })} />
      <ColorRow label="Color 2" value={e.color2} defaultValue={D.color2} onChange={(color2) => upd({ color2 })} />
      <ColorRow label="Color 3" value={e.color3} defaultValue={D.color3} onChange={(color3) => upd({ color3 })} />
      <ColorRow label="Background" value={e.bgColor} defaultValue={D.bgColor} onChange={(bgColor) => upd({ bgColor })} />
      <SliderRow label="Softness" min={0} max={1} step={0.01} value={e.softness} defaultValue={D.softness} display={e.softness.toFixed(2)} onChange={(softness) => upd({ softness })} />
    </>
  );
}

function DotsControls({ e, upd }: { e: Extract<BgEffect, { preset: "dots" }>; upd: Upd }) {
  const D = defaultEffect("dots") as typeof e;
  return (
    <>
      <ColorRow label="Dots" value={e.dotColor} defaultValue={D.dotColor} onChange={(dotColor) => upd({ dotColor })} />
      <ColorRow label="Background" value={e.bgColor} defaultValue={D.bgColor} onChange={(bgColor) => upd({ bgColor })} />
      <SliderRow label="Size" min={1} max={10} step={0.5} value={e.size} defaultValue={D.size} display={e.size.toFixed(1)} onChange={(size) => upd({ size })} />
      <SliderRow label="Gap" min={6} max={80} value={e.gap} defaultValue={D.gap} onChange={(gap) => upd({ gap })} />
    </>
  );
}

function EffectControls({ effect, set }: { effect: BgEffect; set: (patch: { effect: BgEffect }) => void }) {
  const upd: Upd = (patch) => set({ effect: { ...effect, ...patch } as BgEffect });
  return (
    <>
      <SelectField label="Preset" value={effect.preset} options={BG_PRESET_OPTIONS} onChange={(preset) => set({ effect: defaultEffect(preset) })} />
      {effect.preset === "grainient" && <GrainientControls e={effect} upd={upd} />}
      {effect.preset === "aurora" && <AuroraControls e={effect} upd={upd} />}
      {effect.preset === "mesh" && <MeshControls e={effect} upd={upd} />}
      {effect.preset === "dots" && <DotsControls e={effect} upd={upd} />}
    </>
  );
}

function EffectProps({ layer, set, cw, ch }: { layer: EffectLayer; set: Setter; cw: number; ch: number }) {
  const D = newEffectLayer();
  return (
    <Section title="Effect">
      <QuackButton
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => set({ x: 0, y: 0, w: cw, h: ch, rotation: 0, radius: 0 })}
      >
        <Maximize /> Full screen
      </QuackButton>
      <EffectControls effect={layer.effect} set={set} />
      <SliderRow label="Corner radius" min={0} max={400} value={layer.radius} defaultValue={D.radius} onChange={(radius) => set({ radius })} />
    </Section>
  );
}

const FORMAT_OPTIONS = Object.values(FORMATS).map((f) => ({ value: f.key, label: f.label }));

/** Doc-level canvas format switcher. Switching translates layers by the canvas-center
 *  delta (see the `setFormat` reducer case) — one discrete undo entry. */
export function FormatSection({ format, dispatch }: { format: FormatKey; dispatch: Dispatch<Action> }) {
  return (
    <Section title="Format">
      <SelectField label="Canvas format" value={format} options={FORMAT_OPTIONS} onChange={(f) => dispatch({ type: "setFormat", format: f })} />
    </Section>
  );
}

/** Full-canvas paint that lands on top of every layer — the one way a transparent document
 *  still exports opaque, so the panel says so rather than letting it be discovered in Preview. */
const fillsAlpha = (bg: Background): boolean =>
  bg.overlay > 0 || (bg.gradeAmount ?? 0) > 0 || (bg.gradeVignette ?? 0) > 0 || (bg.gradeGrain ?? 0) > 0;

export function BackgroundInspector({
  background, dispatch, onError,
}: { background: Background; dispatch: Dispatch<Action>; onError: (msg: string) => void }) {
  const set = (patch: Partial<Background>) => dispatch({ type: "updateBackground", patch });

  async function onUploadBg(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD) return onError("Background image too large (max 8 MB)");
    try {
      onError("");
      set({ mode: "image", image: await loadImageFile(file), overlay: background.overlay || 35 });
    } catch {
      onError("Couldn't read the image.");
    }
  }

  return (
    <>
    <Section title="Background">
      <UploadButton label="Upload background…" icon={<ImagePlus />} className="w-full" onFile={(f) => void onUploadBg(f)} />
      {background.mode === "image" && background.image ? (
        <>
          <img className="sticker max-h-24 w-full rounded-lg border-border object-contain" src={background.image} alt="" />
          <QuackButton variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => set({ mode: "gradient", image: null })}>
            Remove background
          </QuackButton>
          <SliderRow label="Darken" min={0} max={100} value={background.overlay} display={`${background.overlay}%`} onChange={(overlay) => set({ overlay })} />
          <SliderRow label="Zoom" min={100} max={200} value={background.imageZoom ?? 100} defaultValue={100} display={`${background.imageZoom ?? 100}%`} onChange={(imageZoom) => set({ imageZoom })} />
          <SliderRow label="Position X" min={-25} max={25} value={background.imageX ?? 0} defaultValue={0} display={`${background.imageX ?? 0}%`} onChange={(imageX) => set({ imageX })} />
          <SliderRow label="Position Y" min={-25} max={25} value={background.imageY ?? 0} defaultValue={0} display={`${background.imageY ?? 0}%`} onChange={(imageY) => set({ imageY })} />
        </>
      ) : (
        <>
          <SelectField
            label="Type"
            value={background.mode === "image" ? "solid" : background.mode}
            options={BG_MODE_OPTIONS}
            onChange={(mode) => (mode === "effect" ? set({ mode, effect: background.effect ?? defaultEffect("grainient") }) : set({ mode }))}
          />
          {background.mode === "solid" && <ColorRow label="Color" value={background.from} onChange={(from) => set({ from })} />}
          {background.mode === "gradient" && (
            <>
              <ColorRow label="Color" value={background.from} onChange={(from) => set({ from })} />
              <ColorRow label="Color 2" value={background.to} onChange={(to) => set({ to })} />
            </>
          )}
          {background.mode === "effect" && background.effect && (
            <>
              <EffectControls effect={background.effect} set={set} />
              <SliderRow label="Darken" min={0} max={100} value={background.overlay} display={`${background.overlay}%`} onChange={(overlay) => set({ overlay })} />
            </>
          )}
          {background.mode === "transparent" && (
            <Hint>
              Nothing behind the layers — the PNG keeps the alpha, and never falls back to JPEG.
              {fillsAlpha(background) && " Darken, the tint, the vignette and the grain paint over the canvas, so they fill that alpha back in."}
            </Hint>
          )}
        </>
      )}
    </Section>
    <BorderSection background={background} set={set} />
    <GradeSection background={background} set={set} />
    </>
  );
}

const BORDER_STYLE_OPTIONS: { value: BgBorderStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "double", label: "Double" },
];

function BorderSection({ background, set }: { background: Background; set: (p: Partial<Background>) => void }) {
  const D = defaultBgBorder();
  const border = { ...D, ...background.border };
  const setBorder = (patch: Partial<BgBorder>) => set({ border: { ...border, ...patch } });

  return (
    <Section title="Border (full frame)">
      <SwitchRow label="On" checked={border.enabled} defaultValue={D.enabled} onChange={(enabled) => setBorder({ enabled })} />
      {border.enabled && (
        <>
          <ColorRow label="Color" value={border.color} defaultValue={D.color} onChange={(color) => setBorder({ color })} />
          <SelectField label="Style" value={border.style} options={BORDER_STYLE_OPTIONS} onChange={(style) => setBorder({ style })} />
          <SliderRow label="Width" min={1} max={80} value={border.width} defaultValue={D.width} display={`${border.width}px`} onChange={(width) => setBorder({ width })} />
          <SliderRow label="Corner radius" min={0} max={120} value={border.radius} defaultValue={D.radius} display={`${border.radius}px`} onChange={(radius) => setBorder({ radius })} />
          <SliderRow label="Inset" min={0} max={60} value={border.inset} defaultValue={D.inset} display={`${border.inset}px`} onChange={(inset) => setBorder({ inset })} />
          <SliderRow label="Opacity" min={0} max={100} value={border.opacity} defaultValue={D.opacity} display={`${border.opacity}%`} onChange={(opacity) => setBorder({ opacity })} />
        </>
      )}
    </Section>
  );
}

const GRADE_BLEND_OPTIONS: { value: NonNullable<Background["gradeBlend"]>; label: string }[] = [
  { value: "soft-light", label: "Soft light" },
  { value: "overlay", label: "Overlay" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "color", label: "Color" },
];

/** Global colour grade over the whole composite (sits on top of every layer). */
function GradeSection({ background, set }: { background: Background; set: (p: Partial<Background>) => void }) {
  return (
    <Section title="Grade (whole image)">
      <ColorRow label="Tint" value={background.gradeTint ?? "#d97757"} defaultValue="#d97757" onChange={(gradeTint) => set({ gradeTint })} />
      <SliderRow label="Tint strength" min={0} max={100} value={background.gradeAmount ?? 0} defaultValue={0} display={`${background.gradeAmount ?? 0}%`} onChange={(gradeAmount) => set({ gradeAmount })} />
      <SelectField label="Blend" value={background.gradeBlend ?? "soft-light"} options={GRADE_BLEND_OPTIONS} onChange={(gradeBlend) => set({ gradeBlend })} />
      <SliderRow label="Vignette" min={0} max={100} value={background.gradeVignette ?? 0} defaultValue={0} display={`${background.gradeVignette ?? 0}%`} onChange={(gradeVignette) => set({ gradeVignette })} />
      <SliderRow label="Grain" min={0} max={100} value={background.gradeGrain ?? 0} defaultValue={0} display={`${background.gradeGrain ?? 0}%`} onChange={(gradeGrain) => set({ gradeGrain })} />
    </Section>
  );
}
