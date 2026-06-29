import { useState, type Dispatch, type ReactNode } from "react";
import { Camera, ImagePlus, Minus, Pencil, Smile, Sparkles, Square, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  newBrandLayer,
  newEffectLayer,
  newEmojiLayer,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
  type Action,
  type Layer,
} from "../state";
import { loadImageFile } from "../lib/loadImageFile";
import { WebcamCapture } from "./WebcamCapture";
import { ClaudeLogo, ClaudeWordmark } from "./brand";

const MAX_UPLOAD = 8 * 1024 * 1024;

/** Floating, bottom-centred creation dock (Excalidraw-style): every "add a layer"
    action lives here so the side panels stay focused on editing what exists. */
export function Toolbar({ dispatch, onError, drawMode, setDrawMode }: { dispatch: Dispatch<Action>; onError: (msg: string) => void; drawMode: boolean; setDrawMode: (v: boolean) => void }) {
  const [showCam, setShowCam] = useState(false);
  const add = (layer: Layer) => dispatch({ type: "addLayer", layer });

  async function addImage(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD) return onError("Foto troppo grande (max 8 MB)");
    try {
      onError("");
      add(newImageLayer(await loadImageFile(file)));
    } catch {
      onError("Impossibile leggere l'immagine.");
    }
  }

  return (
    <>
      <div className="dock anim-dock pointer-events-auto">
        <DockButton label="Testo" onClick={() => add(newTextLayer())}>
          <Type />
        </DockButton>
        <DockUpload label="Immagine" onFile={(f) => void addImage(f)}>
          <ImagePlus />
        </DockUpload>
        <DockButton label="Webcam" onClick={() => setShowCam(true)}>
          <Camera />
        </DockButton>
        <DockButton label="Emoji" onClick={() => add(newEmojiLayer())}>
          <Smile />
        </DockButton>
        <DockButton label={drawMode ? "Disegno (attivo)" : "Disegno"} active={drawMode} onClick={() => setDrawMode(!drawMode)}>
          <Pencil />
        </DockButton>

        <span className="dock-sep" />

        <DockButton label="Forma" onClick={() => add(newShapeLayer("rect"))}>
          <Square />
        </DockButton>
        <DockButton label="Barra progresso" onClick={() => add(newShapeLayer("bar"))}>
          <Minus />
        </DockButton>
        <DockButton label="Effetto" onClick={() => add(newEffectLayer())}>
          <Sparkles />
        </DockButton>
        <DockButton label="Logo Claude" onClick={() => add(newBrandLayer("logo"))}>
          <span className="size-[1.125rem]"><ClaudeLogo color="currentColor" /></span>
        </DockButton>
        <DockButton label="Scritta Claude" onClick={() => add(newBrandLayer("wordmark"))}>
          <span className="h-3 w-[1.375rem]"><ClaudeWordmark color="currentColor" /></span>
        </DockButton>
      </div>

      {showCam && (
        <WebcamCapture
          onCapture={(src) => { add(newImageLayer(src)); setShowCam(false); }}
          onClose={() => setShowCam(false)}
        />
      )}
    </>
  );
}

function DockButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button type="button" className={cn("dock-btn", active && "bg-primary/20 text-primary ring-1 ring-primary/40")} onClick={onClick} aria-label={label} aria-pressed={active}>
      {children}
      <span className="dock-tip">{label}</span>
    </button>
  );
}

/** Same look as DockButton, but wraps a hidden file input. */
function DockUpload({ label, onFile, children }: { label: string; onFile: (f: File | undefined) => void; children: ReactNode }) {
  return (
    <label className="dock-btn" aria-label={label}>
      {children}
      <span className="dock-tip">{label}</span>
      <input
        type="file"
        accept="image/*,.heic,.heif"
        hidden
        onChange={(e) => { onFile(e.target.files?.[0]); e.currentTarget.value = ""; }}
      />
    </label>
  );
}
