import { useState, type Dispatch } from "react";
import { Camera, ImagePlus, RotateCcw, Scissors, Undo2 } from "lucide-react";
import {
  FONT_LABELS,
  type Action,
  type Background,
  type EmojiLayer,
  type FontKey,
  type ImageLayer,
  type Layer,
  type LayerPatch,
  type ShapeLayer,
  type TextLayer,
} from "../state";
import { removeBackground } from "../lib/bgremove";
import { loadImageFile } from "../lib/loadImageFile";
import { ColorRow, Field, Hint, Section, SelectField, SliderRow, SwitchRow, UploadButton } from "./controls";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { WebcamCapture } from "./WebcamCapture";

const MAX_UPLOAD = 8 * 1024 * 1024;

const FONT_OPTIONS = (Object.keys(FONT_LABELS) as FontKey[]).map((value) => ({ value, label: FONT_LABELS[value] }));
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

type InspectorProps = { selected: Layer | null; dispatch: Dispatch<Action>; onError: (msg: string) => void };

export function Inspector({ selected, dispatch, onError }: InspectorProps) {
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
      {selected.type === "image" && <ImageProps layer={selected} set={set} onError={onError} />}
      {selected.type === "emoji" && <EmojiProps layer={selected} set={set} />}
      {selected.type === "shape" && <ShapeProps layer={selected} set={set} />}
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
      <SwitchRow label="Contorno" checked={layer.stroke} onChange={(stroke) => set({ stroke })} />
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
    </>
  );
}

function ImageProps({ layer, set, onError }: { layer: ImageLayer; set: Setter; onError: (msg: string) => void }) {
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
              <Button variant="ghost" size="sm" className="col-span-2 text-muted-foreground" onClick={() => set({ src: null, origSrc: null })}>
                <RotateCcw /> Rimuovi foto
              </Button>
            </>
          )}
        </div>
      )}
      <SliderRow label="Scala" min={0.2} max={3} step={0.05} value={layer.scale} display={layer.scale.toFixed(2)} onChange={(scale) => set({ scale })} />
      <SliderRow label="Rotazione" min={-180} max={180} value={layer.rotation} display={`${layer.rotation}°`} onChange={(rotation) => set({ rotation })} />
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
          <SwitchRow label="Gradiente" checked={background.mode === "gradient"} onChange={(g) => set({ mode: g ? "gradient" : "solid" })} />
          <ColorRow label="Colore" value={background.from} onChange={(from) => set({ from })} />
          {background.mode === "gradient" && <ColorRow label="Colore 2" value={background.to} onChange={(to) => set({ to })} />}
        </>
      )}
    </Section>
  );
}
