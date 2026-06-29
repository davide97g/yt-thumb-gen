import { useState, type Dispatch } from "react";
import { Camera, ChevronDown, ChevronRight, Crop, ImagePlus, Lasso, Maximize, RotateCcw, Scissors, Undo2 } from "lucide-react";
import {
  CANVAS_H,
  CANVAS_W,
  FONT_LABELS,
  FONTS,
  defaultEffect,
  defaultFx,
  type Action,
  type Background,
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
  dispatch: Dispatch<Action>;
  onError: (msg: string) => void;
  cropMode: CropMode;
  setCropMode: (m: CropMode) => void;
};

export function Inspector({ selected, dispatch, onError, cropMode, setCropMode }: InspectorProps) {
  if (!selected) {
    return (
      <Section title="Proprietà">
        <Hint>Seleziona un livello sul canvas o nella lista per modificarlo.</Hint>
      </Section>
    );
  }
  const set = (patch: LayerPatch) => dispatch({ type: "updateLayer", id: selected.id, patch });
  return (
    <Section title={`Proprietà — ${selected.name}`}>
      <Field label="Nome">
        <Input value={selected.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      {selected.type === "text" && <TextProps layer={selected} set={set} />}
      {selected.type === "image" && <ImageProps layer={selected} set={set} onError={onError} cropMode={cropMode} setCropMode={setCropMode} />}
      {selected.type === "emoji" && <EmojiProps layer={selected} set={set} />}
      {selected.type === "shape" && <ShapeProps layer={selected} set={set} />}
      {selected.type === "effect" && <EffectProps layer={selected} set={set} />}
    </Section>
  );
}

type Setter = (patch: LayerPatch) => void;

function TextProps({ layer, set }: { layer: TextLayer; set: Setter }) {
  return (
    <>
      <Field label="Testo">
        <Textarea rows={2} value={layer.text} onChange={(e) => set({ text: e.target.value })} />
      </Field>
      <SelectField label="Font" value={layer.font} options={FONT_OPTIONS} onChange={(font) => set({ font })} />
      <SliderRow label="Dimensione" min={24} max={220} value={layer.size} onChange={(size) => set({ size })} />
      <ColorRow label="Colore" value={layer.color} onChange={(color) => set({ color })} />
      <SelectField label="Allineamento" value={layer.align} options={ALIGN_OPTIONS} onChange={(align) => set({ align })} />
      <SliderRow label="Interlinea" min={0.8} max={2} step={0.05} value={layer.lineHeight} display={layer.lineHeight.toFixed(2)} onChange={(lineHeight) => set({ lineHeight })} />
      <SliderRow label="Rotazione" min={-180} max={180} value={layer.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
      <SliderRow label="Trasparenza" min={0} max={100} value={layer.opacity ?? 100} display={`${layer.opacity ?? 100}%`} onChange={(opacity) => set({ opacity })} />
      <SwitchRow label="Contorno" checked={layer.stroke} onChange={(stroke) => set({ stroke })} />
      {layer.stroke && (
        <>
          <ColorRow label="Colore contorno" value={layer.strokeColor ?? "#000000"} onChange={(strokeColor) => set({ strokeColor })} />
          <SliderRow label="Spessore contorno" min={1} max={40} value={layer.strokeWidth ?? 5} onChange={(strokeWidth) => set({ strokeWidth })} />
        </>
      )}
      <SwitchRow label="Ombra" checked={layer.shadow} onChange={(shadow) => set({ shadow })} />
      <SwitchRow label="Sfondo pillola" checked={layer.bg.enabled} onChange={(enabled) => set({ bg: { ...layer.bg, enabled } })} />
      {layer.bg.enabled && (
        <>
          <ColorRow label="Colore pillola" value={layer.bg.color} onChange={(color) => set({ bg: { ...layer.bg, color } })} />
          <SliderRow label="Spazio oriz." min={0} max={80} value={layer.bg.padX} onChange={(padX) => set({ bg: { ...layer.bg, padX } })} />
          <SliderRow label="Spazio vert." min={0} max={60} value={layer.bg.padY} onChange={(padY) => set({ bg: { ...layer.bg, padY } })} />
          <SliderRow label="Arrotonda" min={0} max={999} value={layer.bg.radius} onChange={(radius) => set({ bg: { ...layer.bg, radius } })} />
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
      const setColor = (i: number, v: string) => {
        const colors = [...fx.colors] as [string, string, string];
        colors[i] = v;
        upd({ colors });
      };
      return (
        <>
          <ColorRow label="Colore 1" value={fx.colors[0]} onChange={(v) => setColor(0, v)} />
          <ColorRow label="Colore 2" value={fx.colors[1]} onChange={(v) => setColor(1, v)} />
          <ColorRow label="Colore 3" value={fx.colors[2]} onChange={(v) => setColor(2, v)} />
          <SelectField label="Direzione" value={fx.direction} options={GRAD_DIR_OPTIONS} onChange={(direction) => upd({ direction })} />
          <SliderRow label="Velocità" min={1} max={20} value={fx.speed} display={`${fx.speed}s`} onChange={(speed) => upd({ speed })} />
        </>
      );
    }
    case "shiny":
      return (
        <>
          <ColorRow label="Colore" value={fx.color} onChange={(color) => upd({ color })} />
          <ColorRow label="Riflesso" value={fx.shineColor} onChange={(shineColor) => upd({ shineColor })} />
          <SliderRow label="Ampiezza" min={0} max={360} value={fx.spread} display={`${fx.spread}°`} onChange={(spread) => upd({ spread })} />
          <SelectField label="Direzione" value={fx.direction} options={SHINY_DIR_OPTIONS} onChange={(direction) => upd({ direction })} />
          <SliderRow label="Velocità" min={0.5} max={8} step={0.5} value={fx.speed} display={`${fx.speed}s`} onChange={(speed) => upd({ speed })} />
        </>
      );
    case "glitch":
      return (
        <>
          <ColorRow label="Colore 1" value={fx.color1} onChange={(color1) => upd({ color1 })} />
          <ColorRow label="Colore 2" value={fx.color2} onChange={(color2) => upd({ color2 })} />
          <SliderRow label="Velocità" min={0.2} max={5} step={0.1} value={fx.speed} display={`${fx.speed.toFixed(1)}×`} onChange={(speed) => upd({ speed })} />
          <SwitchRow label="Ombre" checked={fx.enableShadows} onChange={(enableShadows) => upd({ enableShadows })} />
        </>
      );
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

  return (
    <>
      {layer.brand ? (
        <ColorRow label="Colore mark" value={layer.brandColor} onChange={(brandColor) => set({ brandColor })} />
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
      <SliderRow label="Scala" min={0.2} max={3} step={0.05} value={layer.scale} display={layer.scale.toFixed(2)} onChange={(scale) => set({ scale })} />
      <SliderRow label="Rotazione" min={-180} max={180} value={layer.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
      <SliderRow label="Trasparenza" min={0} max={100} value={layer.opacity ?? 100} display={`${layer.opacity ?? 100}%`} onChange={(opacity) => set({ opacity })} />
      {!layer.brand && (
        <>
          <SliderRow label="Arrotonda" min={0} max={220} value={layer.radius} onChange={(radius) => set({ radius })} />
          <SwitchRow label="Bordo" checked={layer.ring} onChange={(ring) => set({ ring })} />
          {layer.ring && <ColorRow label="Colore bordo" value={layer.ringColor} onChange={(ringColor) => set({ ringColor })} />}
        </>
      )}
      <SwitchRow label="Specchia" checked={layer.flip} onChange={(flip) => set({ flip })} />
      {!layer.brand && (
        <>
          <SwitchRow label="Bagliore" checked={layer.glow} onChange={(glow) => set({ glow })} />
          {layer.glow && (
            <>
              <ColorRow label="Colore bagliore" value={layer.glowColor} onChange={(glowColor) => set({ glowColor })} />
              <SliderRow label="Intensità" min={4} max={48} value={layer.glowSize} onChange={(glowSize) => set({ glowSize })} />
            </>
          )}
        </>
      )}
      {showCam && <WebcamCapture onCapture={(src) => set({ src, origSrc: null, brand: null })} onClose={() => setShowCam(false)} />}
    </>
  );
}

function EmojiProps({ layer, set }: { layer: EmojiLayer; set: Setter }) {
  return (
    <>
      <Field label="Emoji">
        <Input value={layer.glyph} onChange={(e) => set({ glyph: e.target.value })} />
      </Field>
      <SliderRow label="Dimensione" min={40} max={360} value={layer.size} onChange={(size) => set({ size })} />
      <SliderRow label="Rotazione" min={-180} max={180} value={layer.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
    </>
  );
}

function ShapeProps({ layer, set }: { layer: ShapeLayer; set: Setter }) {
  return (
    <>
      <SelectField label="Tipo" value={layer.kind} options={SHAPE_OPTIONS} onChange={(kind) => set({ kind })} />
      <ColorRow label="Colore" value={layer.fill} onChange={(fill) => set({ fill })} />
      <SliderRow label="Larghezza" min={20} max={1280} value={layer.w} onChange={(w) => set({ w })} />
      <SliderRow label="Altezza" min={6} max={720} value={layer.h} onChange={(h) => set({ h })} />
      {layer.kind === "rect" && <SliderRow label="Arrotonda" min={0} max={220} value={layer.radius} onChange={(radius) => set({ radius })} />}
      <SliderRow label="Rotazione" min={-180} max={180} value={layer.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
      {layer.kind === "bar" && (
        <>
          <SliderRow label="Guardato" min={0} max={100} value={layer.pct} display={`${layer.pct}%`} onChange={(pct) => set({ pct })} />
          <ColorRow label="Colore traccia" value={layer.trackColor} onChange={(trackColor) => set({ trackColor })} />
        </>
      )}
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
  return (
    <>
      <ColorRow label="Colore 1" value={e.color1} onChange={(color1) => upd({ color1 })} />
      <ColorRow label="Colore 2" value={e.color2} onChange={(color2) => upd({ color2 })} />
      <ColorRow label="Colore 3" value={e.color3} onChange={(color3) => upd({ color3 })} />
      <SliderRow label="Velocità" min={0} max={2} step={0.05} value={e.timeSpeed} display={e.timeSpeed.toFixed(2)} onChange={(timeSpeed) => upd({ timeSpeed })} />
      <SliderRow label="Bilanc. colore" min={-1} max={1} step={0.01} value={e.colorBalance} display={e.colorBalance.toFixed(2)} onChange={(colorBalance) => upd({ colorBalance })} />
      <SliderRow label="Warp forza" min={0} max={3} step={0.05} value={e.warpStrength} display={e.warpStrength.toFixed(2)} onChange={(warpStrength) => upd({ warpStrength })} />
      <SliderRow label="Warp frequenza" min={0} max={20} step={0.1} value={e.warpFrequency} display={e.warpFrequency.toFixed(1)} onChange={(warpFrequency) => upd({ warpFrequency })} />
      <SliderRow label="Warp velocità" min={0} max={10} step={0.1} value={e.warpSpeed} display={e.warpSpeed.toFixed(1)} onChange={(warpSpeed) => upd({ warpSpeed })} />
      <SliderRow label="Warp ampiezza" min={1} max={200} value={e.warpAmplitude} onChange={(warpAmplitude) => upd({ warpAmplitude })} />
      <SliderRow label="Angolo blend" min={-180} max={180} value={e.blendAngle} display={`${e.blendAngle}°`} onChange={(blendAngle) => upd({ blendAngle })} />
      <SliderRow label="Morbidezza blend" min={0} max={1} step={0.01} value={e.blendSoftness} display={e.blendSoftness.toFixed(2)} onChange={(blendSoftness) => upd({ blendSoftness })} />
      <SliderRow label="Grana quantità" min={0} max={1} step={0.01} value={e.grainAmount} display={e.grainAmount.toFixed(2)} onChange={(grainAmount) => upd({ grainAmount })} />
      <SliderRow label="Grana scala" min={0} max={10} step={0.1} value={e.grainScale} display={e.grainScale.toFixed(1)} onChange={(grainScale) => upd({ grainScale })} />
      <SwitchRow label="Grana animata" checked={e.grainAnimated} onChange={(grainAnimated) => upd({ grainAnimated })} />
      <SliderRow label="Contrasto" min={0} max={3} step={0.05} value={e.contrast} display={e.contrast.toFixed(2)} onChange={(contrast) => upd({ contrast })} />
      <SliderRow label="Saturazione" min={0} max={2} step={0.05} value={e.saturation} display={e.saturation.toFixed(2)} onChange={(saturation) => upd({ saturation })} />
      <DisclosureRow open={adv} onToggle={() => setAdv((v) => !v)} label="Avanzate" />
      {adv && (
        <>
          <SliderRow label="Rotazione" min={0} max={1000} step={10} value={e.rotationAmount} onChange={(rotationAmount) => upd({ rotationAmount })} />
          <SliderRow label="Scala rumore" min={0} max={10} step={0.1} value={e.noiseScale} display={e.noiseScale.toFixed(1)} onChange={(noiseScale) => upd({ noiseScale })} />
          <SliderRow label="Gamma" min={0.1} max={3} step={0.05} value={e.gamma} display={e.gamma.toFixed(2)} onChange={(gamma) => upd({ gamma })} />
          <SliderRow label="Centro X" min={-1} max={1} step={0.01} value={e.centerX} display={e.centerX.toFixed(2)} onChange={(centerX) => upd({ centerX })} />
          <SliderRow label="Centro Y" min={-1} max={1} step={0.01} value={e.centerY} display={e.centerY.toFixed(2)} onChange={(centerY) => upd({ centerY })} />
          <SliderRow label="Zoom" min={0.1} max={3} step={0.05} value={e.zoom} display={e.zoom.toFixed(2)} onChange={(zoom) => upd({ zoom })} />
        </>
      )}
    </>
  );
}

function AuroraControls({ e, upd }: { e: Extract<BgEffect, { preset: "aurora" }>; upd: Upd }) {
  return (
    <>
      <ColorRow label="Colore 1" value={e.color1} onChange={(color1) => upd({ color1 })} />
      <ColorRow label="Colore 2" value={e.color2} onChange={(color2) => upd({ color2 })} />
      <ColorRow label="Colore 3" value={e.color3} onChange={(color3) => upd({ color3 })} />
      <SliderRow label="Velocità" min={0} max={3} step={0.05} value={e.speed} display={e.speed.toFixed(2)} onChange={(speed) => upd({ speed })} />
      <SliderRow label="Sfumatura" min={0} max={1} step={0.01} value={e.blend} display={e.blend.toFixed(2)} onChange={(blend) => upd({ blend })} />
      <SliderRow label="Ampiezza" min={0} max={3} step={0.05} value={e.amplitude} display={e.amplitude.toFixed(2)} onChange={(amplitude) => upd({ amplitude })} />
    </>
  );
}

function MeshControls({ e, upd }: { e: Extract<BgEffect, { preset: "mesh" }>; upd: Upd }) {
  return (
    <>
      <ColorRow label="Colore 1" value={e.color1} onChange={(color1) => upd({ color1 })} />
      <ColorRow label="Colore 2" value={e.color2} onChange={(color2) => upd({ color2 })} />
      <ColorRow label="Colore 3" value={e.color3} onChange={(color3) => upd({ color3 })} />
      <ColorRow label="Sfondo" value={e.bgColor} onChange={(bgColor) => upd({ bgColor })} />
      <SliderRow label="Morbidezza" min={0} max={1} step={0.01} value={e.softness} display={e.softness.toFixed(2)} onChange={(softness) => upd({ softness })} />
    </>
  );
}

function DotsControls({ e, upd }: { e: Extract<BgEffect, { preset: "dots" }>; upd: Upd }) {
  return (
    <>
      <ColorRow label="Punti" value={e.dotColor} onChange={(dotColor) => upd({ dotColor })} />
      <ColorRow label="Sfondo" value={e.bgColor} onChange={(bgColor) => upd({ bgColor })} />
      <SliderRow label="Dimensione" min={1} max={10} step={0.5} value={e.size} display={e.size.toFixed(1)} onChange={(size) => upd({ size })} />
      <SliderRow label="Distanza" min={6} max={80} value={e.gap} onChange={(gap) => upd({ gap })} />
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
      <SliderRow label="Arrotonda" min={0} max={400} value={layer.radius} onChange={(radius) => set({ radius })} />
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
    <Section title="Sfondo">
      <UploadButton label="Carica sfondo…" icon={<ImagePlus />} className="w-full" onFile={(f) => void onUploadBg(f)} />
      {background.mode === "image" && background.image ? (
        <>
          <img className="max-h-24 w-full rounded-md border border-border object-contain" src={background.image} alt="" />
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => set({ mode: "gradient", image: null })}>
            Rimuovi sfondo
          </Button>
          <SliderRow label="Ombra" min={0} max={100} value={background.overlay} display={`${background.overlay}%`} onChange={(overlay) => set({ overlay })} />
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
  );
}
