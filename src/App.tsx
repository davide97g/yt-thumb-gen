import { useEffect, useReducer, useRef, useState } from "react";
import { ControlPanel } from "./components/ControlPanel";
import { CANVAS_H, CANVAS_W, ThumbCanvas } from "./components/ThumbCanvas";
import { exportThumb } from "./lib/export";
import { getWorking, setWorking } from "./lib/storage";
import { reducer, type AppState } from "./state";
import { TEMPLATES } from "./presets";

const initial: AppState = { doc: TEMPLATES.loud(), selectedId: null };

export default function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [hydrated, setHydrated] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState("thumb.png");

  // Latest selection, read by the global key handler without rebinding it each render.
  const selRef = useRef(state.selectedId);
  selRef.current = state.selectedId;

  // Hydrate the working canvas from IndexedDB once on mount (falls back to the seeded template).
  useEffect(() => {
    getWorking()
      .then((doc) => { if (doc) dispatch({ type: "loadDoc", doc }); })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // Autosave the working canvas (debounced) once hydrated, so a refresh never loses work.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => void setWorking(state.doc), 400);
    return () => clearTimeout(t);
  }, [state.doc, hydrated]);

  // Backspace / Delete removes the selected layer, unless focus is in a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (!selRef.current) return;
      e.preventDefault();
      dispatch({ type: "removeLayer", id: selRef.current });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = previewRef.current!;
    const ro = new ResizeObserver(() => {
      const pad = 48;
      setScale(Math.min((el.clientWidth - pad) / CANVAS_W, (el.clientHeight - pad) / CANVAS_H));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function onExport() {
    if (!canvasRef.current) return;
    setExporting(true);
    setMessage(null);
    // Let the `exporting` render commit first so the selection outline is hidden in the capture.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    try {
      const { warning } = await exportThumb(canvasRef.current, fileName);
      if (warning) setMessage(warning);
    } catch (err) {
      setMessage(`Export fallito: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-full">
      <ControlPanel
        state={state}
        dispatch={dispatch}
        onExport={onExport}
        exporting={exporting}
        exportError={message}
        fileName={fileName}
        onFileNameChange={setFileName}
        onUploadError={setMessage}
      />
      <main ref={previewRef} className="flex flex-1 items-center justify-center overflow-hidden p-6">
        <div
          className="overflow-hidden rounded-md shadow-2xl ring-1 ring-border"
          style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}
        >
          <ThumbCanvas
            doc={state.doc}
            scale={scale}
            selectedId={state.selectedId}
            exporting={exporting}
            canvasRef={canvasRef}
            dispatch={dispatch}
          />
        </div>
      </main>
    </div>
  );
}
