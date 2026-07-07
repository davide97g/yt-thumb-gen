import { useState, type Dispatch } from "react";
import {
  AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween, Camera, ChevronDown, ChevronRight, Crop, Group, ImagePlus, Lasso, Maximize,
  RotateCcw, Scissors, Undo2, Ungroup,
} from "lucide-react";
import { alignBoxes, distributeBoxes, type AlignEdge, type Placed } from "../lib/layout";
import {
  CANVAS_H,
  CANVAS_W,
  FONT_LABELS,
  FONTS,
  defaultEffect,
  defaultBgBorder,
  defaultFx,
  newTextLayer,
  newImageLayer,
  newBrandLayer,
  newEmojiLayer,
  newShapeLayer,
  newEffectLayer,
  newDrawLayer,
  type Action,
  type DrawCap,
  type DrawLayer,
  type Background,
  type BgBorder,
  type BgBorderStyle,
  type BgEffect,
  type EffectLayer,
  type EmojiLayer,
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
import { ColorRow, Field, Hint, Section, SelectField, SliderRow, SwitchRow, UploadButton } from "./controls";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { WebcamCapture } from "./WebcamCapture";

const MAX_UPLOAD = 8 * 1024 * 1024;

const FONT_OPTIONS = (Object.keys(FONT_LABELS) as FontKey[]).map((value) => ({ value, label: FONT_LABELS[value], style: { fontFamily: FONTS[value] } }));
const ALIGN_OPTIONS: { value: TextLayer["align"]; label: string }[] = [
  { value: "left", label: "Sinistra" },
  { value: "center", label: "Centro" },
  { value: "right", label: "Destra" },
];
const SHAPE_OPTIONS: { value: ShapeLayer["kind"]; label: string }[] = [
  { value: "rect", label: "Rettangolo" },
  { value: "pill", label: "Pillola" },
  { value: "bar", label: "Barra progresso" },
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
};

/** Measure a selected layer's rendered box (canvas units) straight from the DOM. */
function placedOf(id: string, layers: Layer[]): Placed | null {
  const el = document.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);
  const l = layers.find((x) => x.id === id);
  if (!el || !l) return null;
  return { id, box: { x: l.x, y: l.y, w: el.offsetWidth, h: el.offsetHeight } };
}

function AlignSection({ selectedIds, layers, dispatch }: { selectedIds: string[]; layers: Layer[]; dispatch: Dispatch<Action> }) {
  if (selectedIds.length < 2) return null;
  const placed = () => selectedIds.map((id) => placedOf(id, layers)).filter((p): p is Placed => p !== null);
  const align = (edge: AlignEdge) => dispatch({ type: "setPositions", positions: alignBoxes(placed(), edge) });
  const distribute = (axis: "h" | "v") => dispatch({ type: "setPositions", positions: distributeBoxes(placed(), axis) });
  const hasGroup = selectedIds.some((id) => layers.find((l) => l.id === id)?.groupId);
  const canDistribute = selectedIds.length >= 3;

  const btn = "flex h-8 flex-1 items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-40 disabled:pointer-events-none [&_svg]:size-4";
  return (
    <Section title={`Allinea · ${selectedIds.length} livelli`}>
      <div className="space-y-1.5">
        <div className="flex gap-1">
          <button className={btn} title="Allinea a sinistra" onClick={() => align("left")}><AlignHorizontalJustifyStart /></button>
          <button className={btn} title="Centra orizzontalmente" onClick={() => align("hcenter")}><AlignHorizontalJustifyCenter /></button>
          <button className={btn} title="Allinea a destra" onClick={() => align("right")}><AlignHorizontalJustifyEnd /></button>
          <button className={btn} title="Allinea in alto" onClick={() => align("top")}><AlignVerticalJustifyStart /></button>
          <button className={btn} title="Centra verticalmente" onClick={() => align("vcenter")}><AlignVerticalJustifyCenter /></button>
          <button className={btn} title="Allinea in basso" onClick={() => align("bottom")}><AlignVerticalJustifyEnd /></button>
        </div>
        <div className="flex gap-1">
          <button className={btn} disabled={!canDistribute} title="Distribuisci orizzontalmente" onClick={() => distribute("h")}><AlignHorizontalSpaceBetween /></button>
          <button className={btn} disabled={!canDistribute} title="Distribuisci verticalmente" onClick={() => distribute("v")}><AlignVerticalSpaceBetween /></button>
          <button className={btn} title="Raggruppa (⌘G)" onClick={() => dispatch({ type: "group", ids: selectedIds })}><Group /></button>
          <button className={btn} disabled={!hasGroup} title="Separa (⌘⇧G)" onClick={() => dispatch({ type: "ungroup", ids: selectedIds })}><Ungroup /></button>
        </div>
      </div>
    </Section>
  );
}

export function Inspector({ selected, selectedIds, layers, dispatch, onError, cropMode, setCropMode, onFontPreview }: InspectorProps) {
  if (!selected) {
    return (
      <Section title="Proprietà">
        <Hint>Seleziona un livello sul canvas o nella lista per modificarlo.</Hint>
      </Section>
    );
  }
  const set = (patch: LayerPatch) => dispatch({ type: "updateLayer", id: selected.id, patch });
  return (
    <>
      <AlignSection selectedIds={selectedIds} layers={layers} dispatch={dispatch} />
      <Section title={`Proprietà — ${selected.name}`}>
        <Field label="Nome">
          <Input value={selected.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        {selected.type === "text" && <TextProps layer={selected} set={set} onFontPreview={onFontPreview} />}
        {selected.type === "image" && <ImageProps layer={selected} set={set} onError={onError} cropMode={cropMode} setCropMode={setCropMode} />}
        {selected.type === "emoji" && <EmojiProps layer={selected} set={set} />}
        {selected.type === "shape" && <ShapeProps layer={selected} set={set} />}
        {selected.type === "effect" && <EffectProps layer={selected} set={set} />}
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
      <Field label="Testo">
        <Textarea rows={2} value={layer.text} onChange={(e) => set({ text: e.target.value })} />
      </Field>
      <SelectField label="Font" value={layer.font} options={FONT_OPTIONS} onChange={(font) => set({ font })} onPreview={onFontPreview} />
      <SliderRow label="Dimensione" min={6} max={220} value={layer.size} defaultValue={D.size} onChange={(size) => set({ size })} />
      <ColorRow label="Colore" value={layer.color} defaultValue={D.color} onChange={(color) => set({ color })} />
      <SelectField label="Allineamento" value={layer.align} options={ALIGN_OPTIONS} onChange={(align) => set({ align })} />
      <SliderRow label="Interlinea" min={0.8} max={2} step={0.05} value={layer.lineHeight} defaultValue={D.lineHeight} display={layer.lineHeight.toFixed(2)} onChange={(lineHeight) => set({ lineHeight })} />
      <SliderRow label="Rotazione" min={-180} max={180} value={layer.rotation} defaultValue={D.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
      <SliderRow label="Trasparenza" min={0} max={100} value={layer.opacity ?? 100} defaultValue={D.opacity} display={`${layer.opacity ?? 100}%`} onChange={(opacity) => set({ opacity })} />
      <SwitchRow label="Contorno" checked={layer.stroke} defaultValue={D.stroke} onChange={(stroke) => set({ stroke })} />
      {layer.stroke && (
        <>
          <ColorRow label="Colore contorno" value={layer.strokeColor ?? "#000000"} defaultValue={D.strokeColor} onChange={(strokeColor) => set({ strokeColor })} />
          <SliderRow label="Spessore contorno" min={1} max={40} value={layer.strokeWidth ?? 5} defaultValue={D.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} />
        </>
      )}
      <SwitchRow label="Ombra" checked={layer.shadow} defaultValue={D.shadow} onChange={(shadow) => set({ shadow })} />
      <SwitchRow label="Sfondo pillola" checked={layer.bg.enabled} defaultValue={D.bg.enabled} onChange={(enabled) => set({ bg: { ...layer.bg, enabled } })} />
      {layer.bg.enabled && (
        <>
          <ColorRow label="Colore pillola" value={layer.bg.color} defaultValue={D.bg.color} onChange={(color) => set({ bg: { ...layer.bg, color } })} />
          <SliderRow label="Spazio oriz." min={0} max={80} value={layer.bg.padX} defaultValue={D.bg.padX} onChange={(padX) => set({ bg: { ...layer.bg, padX } })} />
          <SliderRow label="Spazio vert." min={0} max={60} value={layer.bg.padY} defaultValue={D.bg.padY} onChange={(padY) => set({ bg: { ...layer.bg, padY } })} />
          <SliderRow label="Arrotonda" min={0} max={999} value={layer.bg.radius} defaultValue={D.bg.radius} onChange={(radius) => set({ bg: { ...layer.bg, radius } })} />
        </>
      )}
      <SelectField
        label="Effetto"
        value={layer.fx?.kind ?? "none"}
        options={TEXT_FX_OPTIONS}
        onChange={(kind) => set({ fx: defaultFx(kind) })}
      />
      {layer.fx && layer.fx.kind !== "none" && <TextFxControls fx={layer.fx} set={set} />}
    </>
  );
}

const TEXT_FX_OPTIONS: { value: TextFx["kind"]; label: string }[] = [
  { value: "none", label: "Nessuno" },
  { value: "gradient", label: "Gradiente" },
  { value: "shiny", label: "Lucido" },
  { value: "glitch", label: "Glitch" },
];

const GRAD_DIR_OPTIONS: { value: "horizontal" | "vertical" | "diagonal"; label: string }[] = [
  { value: "horizontal", label: "Orizzontale" },
  { value: "vertical", label: "Verticale" },
  { value: "diagonal", label: "Diagonale" },
];

const SHINY_DIR_OPTIONS: { value: "left" | "right"; label: string }[] = [
  { value: "left", label: "Sinistra" },
  { value: "right", label: "Destra" },
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
          <ColorRow label="Colore 1" value={fx.colors[0]} defaultValue={D.colors[0]} onChange={(v) => setColor(0, v)} />
          <ColorRow label="Colore 2" value={fx.colors[1]} defaultValue={D.colors[1]} onChange={(v) => setColor(1, v)} />
          <ColorRow label="Colore 3" value={fx.colors[2]} defaultValue={D.colors[2]} onChange={(v) => setColor(2, v)} />
          <SelectField label="Direzione" value={fx.direction} options={GRAD_DIR_OPTIONS} onChange={(direction) => upd({ direction })} />
          <SliderRow label="Velocità" min={1} max={20} value={fx.speed} defaultValue={D.speed} display={`${fx.speed}s`} onChange={(speed) => upd({ speed })} />
        </>
      );
    }
    case "shiny": {
      const D = defaultFx("shiny") as typeof fx;
      return (
        <>
          <ColorRow label="Colore" value={fx.color} defaultValue={D.color} onChange={(color) => upd({ color })} />
          <ColorRow label="Riflesso" value={fx.shineColor} defaultValue={D.shineColor} onChange={(shineColor) => upd({ shineColor })} />
          <SliderRow label="Ampiezza" min={0} max={360} value={fx.spread} defaultValue={D.spread} display={`${fx.spread}°`} onChange={(spread) => upd({ spread })} />
          <SelectField label="Direzione" value={fx.direction} options={SHINY_DIR_OPTIONS} onChange={(direction) => upd({ direction })} />
          <SliderRow label="Velocità" min={0.5} max={8} step={0.5} value={fx.speed} defaultValue={D.speed} display={`${fx.speed}s`} onChange={(speed) => upd({ speed })} />
        </>
      );
    }
    case "glitch": {
      const D = defaultFx("glitch") as typeof fx;
      return (
        <>
          <ColorRow label="Colore 1" value={fx.color1} defaultValue={D.color1} onChange={(color1) => upd({ color1 })} />
          <ColorRow label="Colore 2" value={fx.color2} defaultValue={D.color2} onChange={(color2) => upd({ color2 })} />
          <SliderRow label="Velocità" min={0.2} max={5} step={0.1} value={fx.speed} defaultValue={D.speed} display={`${fx.speed.toFixed(1)}×`} onChange={(speed) => upd({ speed })} />
          <SwitchRow label="Ombre" checked={fx.enableShadows} defaultValue={D.enableShadows} onChange={(enableShadows) => upd({ enableShadows })} />
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

function ImageProps({ layer, set, onError, cropMode, setCropMode }: { layer: ImageLayer; set: Setter; onError: (msg: string) => void; cropMode: CropMode; setCropMode: (m: CropMode) => void }) {
  const [busy, setBusy] = useState(false);
  const [showCam, setShowCam] = useState(false);

  async function onUpload(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD) return onError("Foto troppo grande (max 8 MB)");
    try {
      onError("");
      set({ src: await loadImageFile(file), origSrc: null, brand: null });
    } catch {
      onError("Impossibile leggere l'immagine.");
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
          ? "Servizio rimozione sfondo non raggiungibile — avvia ./bgremove (porta 8000)."
          : "Rimozione sfondo non riuscita — riprova.",
      );
    } finally {
      setBusy(false);
    }
  }

  const D = layer.brand ? newBrandLayer(layer.brand) : newImageLayer();
  return (
    <>
      {layer.brand ? (
        <ColorRow label="Colore mark" value={layer.brandColor} defaultValue={D.brandColor} onChange={(brandColor) => set({ brandColor })} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <UploadButton label={layer.src ? "Sostituisci" : "Da file"} icon={<ImagePlus />} onFile={(f) => void onUpload(f)} />
          <Button variant="secondary" size="sm" onClick={() => setShowCam(true)}>
            <Camera /> Camera
          </Button>
          {layer.src && (
            <>
              <Button variant="secondary" size="sm" onClick={onRemoveBg} disabled={busy}>
                <Scissors /> {busy ? "Rimuovo…" : "Rimuovi sfondo"}
              </Button>
              {layer.origSrc && (
                <Button variant="secondary" size="sm" onClick={() => set({ src: layer.origSrc, origSrc: null })}>
                  <Undo2 /> Ripristina
                </Button>
              )}
              <Button variant={cropMode === "rect" ? "default" : "secondary"} size="sm" onClick={() => setCropMode(cropMode === "rect" ? null : "rect")}>
                <Crop /> Ritaglia
              </Button>
              <Button variant={cropMode === "lasso" ? "default" : "secondary"} size="sm" onClick={() => setCropMode(cropMode === "lasso" ? null : "lasso")}>
                <Lasso /> Lazo
              </Button>
              {(layer.crop || layer.mask) && (
                <Button variant="secondary" size="sm" className="col-span-2" onClick={() => { restoreCrop(layer, set); setCropMode(null); }}>
                  <Undo2 /> Ripristina ritaglio
                </Button>
              )}
              <Button variant="ghost" size="sm" className="col-span-2 text-muted-foreground" onClick={() => set({ src: null, origSrc: null })}>
                <RotateCcw /> Rimuovi foto
              </Button>
            </>
          )}
        </div>
      )}
      <SliderRow label="Scala" min={0.2} max={3} step={0.05} value={layer.scale} defaultValue={D.scale} display={layer.scale.toFixed(2)} onChange={(scale) => set({ scale })} />
      <SliderRow label="Rotazione" min={-180} max={180} value={layer.rotation} defaultValue={D.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
      <SliderRow label="Trasparenza" min={0} max={100} value={layer.opacity ?? 100} defaultValue={D.opacity} display={`${layer.opacity ?? 100}%`} onChange={(opacity) => set({ opacity })} />
      {!layer.brand && layer.src && (
        <>
          <SliderRow label="Luminosità" min={0} max={200} value={layer.brightness ?? 100} defaultValue={100} display={`${layer.brightness ?? 100}%`} onChange={(brightness) => set({ brightness })} />
          <SliderRow label="Contrasto" min={0} max={200} value={layer.contrast ?? 100} defaultValue={100} display={`${layer.contrast ?? 100}%`} onChange={(contrast) => set({ contrast })} />
          <SliderRow label="Saturazione" min={0} max={200} value={layer.saturation ?? 100} defaultValue={100} display={`${layer.saturation ?? 100}%`} onChange={(saturation) => set({ saturation })} />
        </>
      )}
      {!layer.brand && (
        <>
          <SliderRow label="Arrotonda" min={0} max={220} value={layer.radius} defaultValue={D.radius} onChange={(radius) => set({ radius })} />
          <SwitchRow label="Bordo" checked={layer.ring} defaultValue={D.ring} onChange={(ring) => set({ ring })} />
          {layer.ring && <ColorRow label="Colore bordo" value={layer.ringColor} defaultValue={D.ringColor} onChange={(ringColor) => set({ ringColor })} />}
        </>
      )}
      <SwitchRow label="Specchia" checked={layer.flip} defaultValue={D.flip} onChange={(flip) => set({ flip })} />
      {!layer.brand && (
        <>
          <SwitchRow label="Bagliore" checked={layer.glow} defaultValue={D.glow} onChange={(glow) => set({ glow })} />
          {layer.glow && (
            <>
              <SelectField
                label="Stile bagliore"
                value={layer.glowStyle}
                options={[
                  { value: "glow", label: "Sfumato" },
                  { value: "line", label: "Linea netta" },
                ]}
                onChange={(glowStyle) => set({ glowStyle })}
              />
              <ColorRow label="Colore bagliore" value={layer.glowColor} defaultValue={D.glowColor} onChange={(glowColor) => set({ glowColor })} />
              <SliderRow label={layer.glowStyle === "line" ? "Spessore" : "Intensità"} min={1} max={48} value={layer.glowSize} defaultValue={D.glowSize} onChange={(glowSize) => set({ glowSize })} />
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
        <Input value={layer.glyph} onChange={(e) => set({ glyph: e.target.value })} />
      </Field>
      <SliderRow label="Dimensione" min={40} max={360} value={layer.size} defaultValue={D.size} onChange={(size) => set({ size })} />
      <SliderRow label="Rotazione" min={-180} max={180} value={layer.rotation} defaultValue={D.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
    </>
  );
}

function ShapeProps({ layer, set }: { layer: ShapeLayer; set: Setter }) {
  const D = newShapeLayer(layer.kind);
  return (
    <>
      <SelectField label="Tipo" value={layer.kind} options={SHAPE_OPTIONS} onChange={(kind) => set({ kind })} />
      <ColorRow label="Colore" value={layer.fill} defaultValue={D.fill} onChange={(fill) => set({ fill })} />
      <SliderRow label="Larghezza" min={20} max={1280} value={layer.w} defaultValue={D.w} onChange={(w) => set({ w })} />
      <SliderRow label="Altezza" min={6} max={720} value={layer.h} defaultValue={D.h} onChange={(h) => set({ h })} />
      {layer.kind === "rect" && <SliderRow label="Arrotonda" min={0} max={220} value={layer.radius} defaultValue={D.radius} onChange={(radius) => set({ radius })} />}
      <SliderRow label="Rotazione" min={-180} max={180} value={layer.rotation} defaultValue={D.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
      {layer.kind === "bar" && (
        <>
          <SliderRow label="Guardato" min={0} max={100} value={layer.pct} defaultValue={D.pct} display={`${layer.pct}%`} onChange={(pct) => set({ pct })} />
          <ColorRow label="Colore traccia" value={layer.trackColor} defaultValue={D.trackColor} onChange={(trackColor) => set({ trackColor })} />
        </>
      )}
    </>
  );
}

const LINE_STYLE_OPTIONS: { value: DrawLayer["lineStyle"]; label: string }[] = [
  { value: "solid", label: "Continua" },
  { value: "dashed", label: "Tratteggiata" },
  { value: "dotted", label: "Punteggiata" },
];
const DRAW_CAP_OPTIONS: { value: DrawCap; label: string }[] = [
  { value: "none", label: "Nessuna" },
  { value: "arrow", label: "Freccia" },
  { value: "dot", label: "Punto" },
  { value: "tee", label: "Barra" },
];

function DrawProps({ layer, set }: { layer: DrawLayer; set: Setter }) {
  const D = newDrawLayer([]); // style defaults; geometry args irrelevant for the reset targets
  return (
    <>
      <ColorRow label="Colore" value={layer.color} defaultValue={D.color} onChange={(color) => set({ color })} />
      <SliderRow label="Spessore" min={1} max={60} value={layer.thickness} defaultValue={D.thickness} onChange={(thickness) => set({ thickness })} />
      <SelectField label="Stile linea" value={layer.lineStyle} options={LINE_STYLE_OPTIONS} onChange={(lineStyle) => set({ lineStyle })} />
      <SliderRow label="Smussatura" min={0} max={100} value={layer.smoothing} defaultValue={D.smoothing} display={`${layer.smoothing}%`} onChange={(smoothing) => set({ smoothing })} />
      <SelectField label="Punta iniziale" value={layer.startCap} options={DRAW_CAP_OPTIONS} onChange={(startCap) => set({ startCap })} />
      <SelectField label="Punta finale" value={layer.endCap} options={DRAW_CAP_OPTIONS} onChange={(endCap) => set({ endCap })} />
      <SliderRow label="Rotazione" min={-180} max={180} value={layer.rotation} defaultValue={D.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
    </>
  );
}

// ── Background ────────────────────────────────────────────────────────────────

const BG_MODE_OPTIONS: { value: "solid" | "gradient" | "effect"; label: string }[] = [
  { value: "solid", label: "Tinta unita" },
  { value: "gradient", label: "Gradiente" },
  { value: "effect", label: "Effetto" },
];

const BG_PRESET_OPTIONS: { value: BgEffect["preset"]; label: string }[] = [
  { value: "grainient", label: "Grainient" },
  { value: "aurora", label: "Aurora" },
  { value: "mesh", label: "Mesh" },
  { value: "dots", label: "Punti" },
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
      <ColorRow label="Colore 1" value={e.color1} defaultValue={D.color1} onChange={(color1) => upd({ color1 })} />
      <ColorRow label="Colore 2" value={e.color2} defaultValue={D.color2} onChange={(color2) => upd({ color2 })} />
      <ColorRow label="Colore 3" value={e.color3} defaultValue={D.color3} onChange={(color3) => upd({ color3 })} />
      <SliderRow label="Velocità" min={0} max={2} step={0.05} value={e.timeSpeed} defaultValue={D.timeSpeed} display={e.timeSpeed.toFixed(2)} onChange={(timeSpeed) => upd({ timeSpeed })} />
      <SliderRow label="Bilanc. colore" min={-1} max={1} step={0.01} value={e.colorBalance} defaultValue={D.colorBalance} display={e.colorBalance.toFixed(2)} onChange={(colorBalance) => upd({ colorBalance })} />
      <SliderRow label="Warp forza" min={0} max={3} step={0.05} value={e.warpStrength} defaultValue={D.warpStrength} display={e.warpStrength.toFixed(2)} onChange={(warpStrength) => upd({ warpStrength })} />
      <SliderRow label="Warp frequenza" min={0} max={20} step={0.1} value={e.warpFrequency} defaultValue={D.warpFrequency} display={e.warpFrequency.toFixed(1)} onChange={(warpFrequency) => upd({ warpFrequency })} />
      <SliderRow label="Warp velocità" min={0} max={10} step={0.1} value={e.warpSpeed} defaultValue={D.warpSpeed} display={e.warpSpeed.toFixed(1)} onChange={(warpSpeed) => upd({ warpSpeed })} />
      <SliderRow label="Warp ampiezza" min={1} max={200} value={e.warpAmplitude} defaultValue={D.warpAmplitude} onChange={(warpAmplitude) => upd({ warpAmplitude })} />
      <SliderRow label="Angolo blend" min={-180} max={180} value={e.blendAngle} defaultValue={D.blendAngle} display={`${e.blendAngle}°`} onChange={(blendAngle) => upd({ blendAngle })} />
      <SliderRow label="Morbidezza blend" min={0} max={1} step={0.01} value={e.blendSoftness} defaultValue={D.blendSoftness} display={e.blendSoftness.toFixed(2)} onChange={(blendSoftness) => upd({ blendSoftness })} />
      <SliderRow label="Grana quantità" min={0} max={1} step={0.01} value={e.grainAmount} defaultValue={D.grainAmount} display={e.grainAmount.toFixed(2)} onChange={(grainAmount) => upd({ grainAmount })} />
      <SliderRow label="Grana scala" min={0} max={10} step={0.1} value={e.grainScale} defaultValue={D.grainScale} display={e.grainScale.toFixed(1)} onChange={(grainScale) => upd({ grainScale })} />
      <SwitchRow label="Grana animata" checked={e.grainAnimated} defaultValue={D.grainAnimated} onChange={(grainAnimated) => upd({ grainAnimated })} />
      <SliderRow label="Contrasto" min={0} max={3} step={0.05} value={e.contrast} defaultValue={D.contrast} display={e.contrast.toFixed(2)} onChange={(contrast) => upd({ contrast })} />
      <SliderRow label="Saturazione" min={0} max={2} step={0.05} value={e.saturation} defaultValue={D.saturation} display={e.saturation.toFixed(2)} onChange={(saturation) => upd({ saturation })} />
      <DisclosureRow open={adv} onToggle={() => setAdv((v) => !v)} label="Avanzate" />
      {adv && (
        <>
          <SliderRow label="Rotazione" min={0} max={1000} step={10} value={e.rotationAmount} defaultValue={D.rotationAmount} onChange={(rotationAmount) => upd({ rotationAmount })} />
          <SliderRow label="Scala rumore" min={0} max={10} step={0.1} value={e.noiseScale} defaultValue={D.noiseScale} display={e.noiseScale.toFixed(1)} onChange={(noiseScale) => upd({ noiseScale })} />
          <SliderRow label="Gamma" min={0.1} max={3} step={0.05} value={e.gamma} defaultValue={D.gamma} display={e.gamma.toFixed(2)} onChange={(gamma) => upd({ gamma })} />
          <SliderRow label="Centro X" min={-1} max={1} step={0.01} value={e.centerX} defaultValue={D.centerX} display={e.centerX.toFixed(2)} onChange={(centerX) => upd({ centerX })} />
          <SliderRow label="Centro Y" min={-1} max={1} step={0.01} value={e.centerY} defaultValue={D.centerY} display={e.centerY.toFixed(2)} onChange={(centerY) => upd({ centerY })} />
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
      <ColorRow label="Colore 1" value={e.color1} defaultValue={D.color1} onChange={(color1) => upd({ color1 })} />
      <ColorRow label="Colore 2" value={e.color2} defaultValue={D.color2} onChange={(color2) => upd({ color2 })} />
      <ColorRow label="Colore 3" value={e.color3} defaultValue={D.color3} onChange={(color3) => upd({ color3 })} />
      <SliderRow label="Velocità" min={0} max={3} step={0.05} value={e.speed} defaultValue={D.speed} display={e.speed.toFixed(2)} onChange={(speed) => upd({ speed })} />
      <SliderRow label="Sfumatura" min={0} max={1} step={0.01} value={e.blend} defaultValue={D.blend} display={e.blend.toFixed(2)} onChange={(blend) => upd({ blend })} />
      <SliderRow label="Ampiezza" min={0} max={3} step={0.05} value={e.amplitude} defaultValue={D.amplitude} display={e.amplitude.toFixed(2)} onChange={(amplitude) => upd({ amplitude })} />
    </>
  );
}

function MeshControls({ e, upd }: { e: Extract<BgEffect, { preset: "mesh" }>; upd: Upd }) {
  const D = defaultEffect("mesh") as typeof e;
  return (
    <>
      <ColorRow label="Colore 1" value={e.color1} defaultValue={D.color1} onChange={(color1) => upd({ color1 })} />
      <ColorRow label="Colore 2" value={e.color2} defaultValue={D.color2} onChange={(color2) => upd({ color2 })} />
      <ColorRow label="Colore 3" value={e.color3} defaultValue={D.color3} onChange={(color3) => upd({ color3 })} />
      <ColorRow label="Sfondo" value={e.bgColor} defaultValue={D.bgColor} onChange={(bgColor) => upd({ bgColor })} />
      <SliderRow label="Morbidezza" min={0} max={1} step={0.01} value={e.softness} defaultValue={D.softness} display={e.softness.toFixed(2)} onChange={(softness) => upd({ softness })} />
    </>
  );
}

function DotsControls({ e, upd }: { e: Extract<BgEffect, { preset: "dots" }>; upd: Upd }) {
  const D = defaultEffect("dots") as typeof e;
  return (
    <>
      <ColorRow label="Punti" value={e.dotColor} defaultValue={D.dotColor} onChange={(dotColor) => upd({ dotColor })} />
      <ColorRow label="Sfondo" value={e.bgColor} defaultValue={D.bgColor} onChange={(bgColor) => upd({ bgColor })} />
      <SliderRow label="Dimensione" min={1} max={10} step={0.5} value={e.size} defaultValue={D.size} display={e.size.toFixed(1)} onChange={(size) => upd({ size })} />
      <SliderRow label="Distanza" min={6} max={80} value={e.gap} defaultValue={D.gap} onChange={(gap) => upd({ gap })} />
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

function EffectProps({ layer, set }: { layer: EffectLayer; set: Setter }) {
  const D = newEffectLayer();
  return (
    <Section title="Effetto">
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={() => set({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, rotation: 0, radius: 0 })}
      >
        <Maximize /> Schermo intero
      </Button>
      <EffectControls effect={layer.effect} set={set} />
      <SliderRow label="Arrotonda" min={0} max={400} value={layer.radius} defaultValue={D.radius} onChange={(radius) => set({ radius })} />
    </Section>
  );
}

export function BackgroundInspector({
  background, dispatch, onError,
}: { background: Background; dispatch: Dispatch<Action>; onError: (msg: string) => void }) {
  const set = (patch: Partial<Background>) => dispatch({ type: "updateBackground", patch });

  async function onUploadBg(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD) return onError("Sfondo troppo grande (max 8 MB)");
    try {
      onError("");
      set({ mode: "image", image: await loadImageFile(file), overlay: background.overlay || 35 });
    } catch {
      onError("Impossibile leggere l'immagine.");
    }
  }

  return (
    <>
    <Section title="Sfondo">
      <UploadButton label="Carica sfondo…" icon={<ImagePlus />} className="w-full" onFile={(f) => void onUploadBg(f)} />
      {background.mode === "image" && background.image ? (
        <>
          <img className="max-h-24 w-full rounded-md border border-border object-contain" src={background.image} alt="" />
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => set({ mode: "gradient", image: null })}>
            Rimuovi sfondo
          </Button>
          <SliderRow label="Ombra" min={0} max={100} value={background.overlay} display={`${background.overlay}%`} onChange={(overlay) => set({ overlay })} />
          <SliderRow label="Zoom" min={100} max={200} value={background.imageZoom ?? 100} defaultValue={100} display={`${background.imageZoom ?? 100}%`} onChange={(imageZoom) => set({ imageZoom })} />
          <SliderRow label="Posizione X" min={-25} max={25} value={background.imageX ?? 0} defaultValue={0} display={`${background.imageX ?? 0}%`} onChange={(imageX) => set({ imageX })} />
          <SliderRow label="Posizione Y" min={-25} max={25} value={background.imageY ?? 0} defaultValue={0} display={`${background.imageY ?? 0}%`} onChange={(imageY) => set({ imageY })} />
        </>
      ) : (
        <>
          <SelectField
            label="Tipo"
            value={background.mode === "image" ? "solid" : background.mode}
            options={BG_MODE_OPTIONS}
            onChange={(mode) => (mode === "effect" ? set({ mode, effect: background.effect ?? defaultEffect("grainient") }) : set({ mode }))}
          />
          {background.mode === "solid" && <ColorRow label="Colore" value={background.from} onChange={(from) => set({ from })} />}
          {background.mode === "gradient" && (
            <>
              <ColorRow label="Colore" value={background.from} onChange={(from) => set({ from })} />
              <ColorRow label="Colore 2" value={background.to} onChange={(to) => set({ to })} />
            </>
          )}
          {background.mode === "effect" && background.effect && (
            <>
              <EffectControls effect={background.effect} set={set} />
              <SliderRow label="Ombra" min={0} max={100} value={background.overlay} display={`${background.overlay}%`} onChange={(overlay) => set({ overlay })} />
            </>
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
  { value: "solid", label: "Pieno" },
  { value: "dashed", label: "Tratteggiato" },
  { value: "dotted", label: "Puntini" },
  { value: "double", label: "Doppio" },
];

function BorderSection({ background, set }: { background: Background; set: (p: Partial<Background>) => void }) {
  const D = defaultBgBorder();
  const border = { ...D, ...background.border };
  const setBorder = (patch: Partial<BgBorder>) => set({ border: { ...border, ...patch } });

  return (
    <Section title="Bordo (tutto schermo)">
      <SwitchRow label="Attivo" checked={border.enabled} defaultValue={D.enabled} onChange={(enabled) => setBorder({ enabled })} />
      {border.enabled && (
        <>
          <ColorRow label="Colore" value={border.color} defaultValue={D.color} onChange={(color) => setBorder({ color })} />
          <SelectField label="Stile" value={border.style} options={BORDER_STYLE_OPTIONS} onChange={(style) => setBorder({ style })} />
          <SliderRow label="Spessore" min={1} max={80} value={border.width} defaultValue={D.width} display={`${border.width}px`} onChange={(width) => setBorder({ width })} />
          <SliderRow label="Arrotonda" min={0} max={120} value={border.radius} defaultValue={D.radius} display={`${border.radius}px`} onChange={(radius) => setBorder({ radius })} />
          <SliderRow label="Margine" min={0} max={60} value={border.inset} defaultValue={D.inset} display={`${border.inset}px`} onChange={(inset) => setBorder({ inset })} />
          <SliderRow label="Opacità" min={0} max={100} value={border.opacity} defaultValue={D.opacity} display={`${border.opacity}%`} onChange={(opacity) => setBorder({ opacity })} />
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
  { value: "color", label: "Colore" },
];

/** Global colour grade over the whole composite (sits on top of every layer). */
function GradeSection({ background, set }: { background: Background; set: (p: Partial<Background>) => void }) {
  return (
    <Section title="Coesione (tutta l'immagine)">
      <ColorRow label="Tinta" value={background.gradeTint ?? "#d97757"} defaultValue="#d97757" onChange={(gradeTint) => set({ gradeTint })} />
      <SliderRow label="Intensità tinta" min={0} max={100} value={background.gradeAmount ?? 0} defaultValue={0} display={`${background.gradeAmount ?? 0}%`} onChange={(gradeAmount) => set({ gradeAmount })} />
      <SelectField label="Fusione" value={background.gradeBlend ?? "soft-light"} options={GRADE_BLEND_OPTIONS} onChange={(gradeBlend) => set({ gradeBlend })} />
      <SliderRow label="Vignetta" min={0} max={100} value={background.gradeVignette ?? 0} defaultValue={0} display={`${background.gradeVignette ?? 0}%`} onChange={(gradeVignette) => set({ gradeVignette })} />
      <SliderRow label="Grana" min={0} max={100} value={background.gradeGrain ?? 0} defaultValue={0} display={`${background.gradeGrain ?? 0}%`} onChange={(gradeGrain) => set({ gradeGrain })} />
    </Section>
  );
}
