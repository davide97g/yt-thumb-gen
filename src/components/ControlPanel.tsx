import { useState, type Dispatch } from "react";
import { Camera, Clapperboard, Download, ImagePlus, Minus, Smile, Sparkles, Square, Type } from "lucide-react";
import {
  newBrandLayer,
  newEmojiLayer,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
  type Action,
  type AppState,
  type Layer,
} from "../state";
import { TEMPLATE_LABELS, TEMPLATES, type TemplateKey } from "../presets";
import { loadImageFile } from "../lib/loadImageFile";
import { Hint, Section, UploadButton } from "./controls";
import { LayerList } from "./LayerList";
import { Inspector, BackgroundInspector } from "./Inspector";
import { SavesPanel } from "./SavesPanel";
import { WebcamCapture } from "./WebcamCapture";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";

const MAX_UPLOAD = 8 * 1024 * 1024;

type Props = {
  state: AppState;
  dispatch: Dispatch<Action>;
  onExport: () => void;
  exporting: boolean;
  exportError: string | null;
  onUploadError: (msg: string) => void;
};

export function ControlPanel({ state, dispatch, onExport, exporting, exportError, onUploadError }: Props) {
  const { doc, selectedId } = state;
  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;
  const [showCam, setShowCam] = useState(false);

  const add = (layer: Layer) => dispatch({ type: "addLayer", layer });

  async function addImage(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD) return onUploadError("Foto troppo grande (max 8 MB)");
    try {
      onUploadError("");
      add(newImageLayer(await loadImageFile(file)));
    } catch {
      onUploadError("Impossibile leggere l'immagine.");
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-card/40 p-4">
      <div className="flex items-center gap-2">
        <Clapperboard className="size-5 text-primary" />
        <h1 className="text-sm font-semibold">GrocerAI Thumb Studio</h1>
      </div>

      <Section title="Modelli">
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(TEMPLATE_LABELS) as TemplateKey[]).map((key) => (
            <Button key={key} variant="outline" size="sm" onClick={() => dispatch({ type: "loadDoc", doc: TEMPLATES[key]() })}>
              {TEMPLATE_LABELS[key]}
            </Button>
          ))}
        </div>
        <Hint>I modelli sostituiscono i livelli attuali. Poi modifichi liberamente.</Hint>
      </Section>

      <Section title="Aggiungi livello">
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" size="sm" onClick={() => add(newTextLayer())}><Type /> Testo</Button>
          <UploadButton label="File" icon={<ImagePlus />} onFile={(f) => void addImage(f)} />
          <Button variant="secondary" size="sm" onClick={() => setShowCam(true)}><Camera /> Camera</Button>
          <Button variant="secondary" size="sm" onClick={() => add(newEmojiLayer())}><Smile /> Emoji</Button>
          <Button variant="secondary" size="sm" onClick={() => add(newShapeLayer("rect"))}><Square /> Forma</Button>
          <Button variant="secondary" size="sm" onClick={() => add(newShapeLayer("bar"))}><Minus /> Barra</Button>
          <Button variant="secondary" size="sm" onClick={() => add(newBrandLayer("logo"))}><Sparkles /> Logo</Button>
          <Button variant="secondary" size="sm" className="col-span-2" onClick={() => add(newBrandLayer("wordmark"))}>Scritta Claude</Button>
        </div>
      </Section>

      <Separator />
      <SavesPanel doc={doc} dispatch={dispatch} onError={onUploadError} />
      <Separator />
      <Section title="Livelli">
        <LayerList layers={doc.layers} selectedId={selectedId} dispatch={dispatch} />
      </Section>
      <Separator />
      <Inspector selected={selected} dispatch={dispatch} onError={onUploadError} />
      <Separator />
      <BackgroundInspector background={doc.background} dispatch={dispatch} onError={onUploadError} />

      <div className="mt-auto space-y-2 border-t border-border pt-4">
        <Button className="w-full" onClick={onExport} disabled={exporting}>
          <Download /> {exporting ? "Esporto…" : "Esporta PNG 1280×720"}
        </Button>
        {exportError && <p className="text-xs text-destructive">{exportError}</p>}
      </div>

      {showCam && <WebcamCapture onCapture={(src) => add(newImageLayer(src))} onClose={() => setShowCam(false)} />}
    </aside>
  );
}
