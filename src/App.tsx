import { useEffect, useReducer, useRef, useState } from "react";
import { Download, FilePlus, Maximize2, PanelsTopLeft, Redo2, Undo2 } from "lucide-react";
import { CANVAS_H, CANVAS_W, ThumbCanvas } from "./components/ThumbCanvas";
import { Inspector, BackgroundInspector } from "./components/Inspector";
import { LayerList } from "./components/LayerList";
import { SavesPanel } from "./components/SavesPanel";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { Toolbar } from "./components/Toolbar";
import { Section } from "./components/controls";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { exportThumb } from "./lib/export";
import { getWorking, setWorking } from "./lib/storage";
import { historyReducer, initHistory, type AppState, type Layer } from "./state";
import { TEMPLATES } from "./presets";

const initial: AppState = { doc: TEMPLATES.dacoder(), selectedId: null };

export default function App() {
  const [hist, dispatch] = useReducer(historyReducer, initial, initHistory);
  const [hydrated, setHydrated] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [savesKey, setSavesKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState("thumb.png");

  const { doc, selectedId } = hist.present;
  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;

  // Latest doc/selection + a copy/paste clipboard, read by the global key handler
  // without rebinding it each render. Clipboard is a layer snapshot (immutable), so
  // it lives outside undo history and survives edits to the original.
  const selRef = useRef(selectedId);
  selRef.current = selectedId;
  const docRef = useRef(doc);
  docRef.current = doc;
  const clipboardRef = useRef<Layer | null>(null);

  // Hydrate working canvas from IndexedDB once on mount (falls back to seeded template).
  useEffect(() => {
    getWorking()
      .then((d) => { if (d) dispatch({ type: "loadDoc", doc: d }); })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // Autosave working canvas (debounced) once hydrated, so refresh never loses work.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => void setWorking(doc), 400);
    return () => clearTimeout(t);
  }, [doc, hydrated]);

  // Backspace / Delete removes the selected layer, unless focus is in a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return; // let inputs keep native undo / copy / paste

      const mod = e.metaKey || e.ctrlKey;
      if (mod) {
        const k = e.key.toLowerCase();
        if (k === "z") { e.preventDefault(); dispatch(e.shiftKey ? { type: "redo" } : { type: "undo" }); return; }
        if (k === "y") { e.preventDefault(); dispatch({ type: "redo" }); return; } // Windows redo
        if (k === "c") { const l = docRef.current.layers.find((x) => x.id === selRef.current); if (l) clipboardRef.current = l; return; }
        if (k === "v" && clipboardRef.current) { e.preventDefault(); dispatch({ type: "pasteLayer", layer: clipboardRef.current }); return; }
        return;
      }
      // "\" toggles all chrome (rails + dock) for a full-bleed preview.
      if (e.key === "\\") { e.preventDefault(); setChromeHidden((v) => !v); return; }
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (selRef.current) dispatch({ type: "removeLayer", id: selRef.current });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fit the canvas to the stage, leaving room for the floating dock + readout.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const padX = 80;
      const padY = 150;
      setScale(Math.max(0.1, Math.min((el.clientWidth - padX) / CANVAS_W, (el.clientHeight - padY) / CANVAS_H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function onExport() {
    if (!canvasRef.current) return;
    setExporting(true);
    setMessage(null);
    // Let `exporting` render commit first so the selection outline is hidden in capture.
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
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card/40 px-4 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setChromeHidden((v) => !v)}
            title={chromeHidden ? "Mostra pannelli (\\)" : "Nascondi pannelli (\\)"}
            aria-label={chromeHidden ? "Mostra pannelli" : "Nascondi pannelli"}
            aria-pressed={chromeHidden}
          >
            {chromeHidden ? <Maximize2 /> : <PanelsTopLeft />}
          </Button>
          <span className="grid size-7 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/25">
            <span className="size-2.5 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Thumb Studio</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">YouTube · 1280×720</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => dispatch({ type: "undo" })}
              disabled={hist.past.length === 0}
              title="Annulla (⌘Z)"
              aria-label="Annulla"
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => dispatch({ type: "redo" })}
              disabled={hist.future.length === 0}
              title="Ripristina (⌘⇧Z)"
              aria-label="Ripristina"
            >
              <Redo2 />
            </Button>
          </div>
          {message && (
            <span
              className={`hidden max-w-64 truncate text-xs md:block ${message.startsWith("Export fallito") ? "text-destructive" : "text-muted-foreground"}`}
              title={message}
            >
              {message}
            </span>
          )}
          <Input
            className="h-8 w-40"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="thumb.png"
            aria-label="Nome file"
          />
          <Button className="h-8" onClick={onExport} disabled={exporting}>
            <Download /> {exporting ? "Esporto…" : "Esporta PNG"}
          </Button>
        </div>
      </header>

      {/* ── Body: left rail · stage · inspector ─────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {!chromeHidden && (
          <aside className="anim-panel-l panel panel-scroll flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border p-4">
            <Section title="Progetto">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => setNewOpen(true)}
              >
                <FilePlus /> Nuovo progetto
              </Button>
            </Section>

            <Section title="Livelli">
              <LayerList layers={doc.layers} selectedId={selectedId} dispatch={dispatch} />
            </Section>

            <SavesPanel doc={doc} dispatch={dispatch} onError={setMessage} refreshKey={savesKey} />
          </aside>
        )}

        <main ref={previewRef} className="stage relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-8">
          <div
            className="overflow-hidden rounded-lg shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10"
            style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}
          >
            <ThumbCanvas
              doc={doc}
              scale={scale}
              selectedId={selectedId}
              exporting={exporting}
              canvasRef={canvasRef}
              dispatch={dispatch}
            />
          </div>

          <div className="pointer-events-none absolute bottom-4 left-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
            1280 × 720 · {Math.round(scale * 100)}%
          </div>

          {!chromeHidden && (
            <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2">
              <Toolbar dispatch={dispatch} onError={setMessage} />
            </div>
          )}
        </main>

        {!chromeHidden && (
          <aside className="anim-panel-r panel panel-scroll flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border p-4">
            <Inspector selected={selected} dispatch={dispatch} onError={setMessage} />
            <BackgroundInspector background={doc.background} dispatch={dispatch} onError={setMessage} />
          </aside>
        )}
      </div>

      {newOpen && (
        <NewProjectDialog
          doc={doc}
          onClose={() => setNewOpen(false)}
          onCreated={(d) => { dispatch({ type: "loadDoc", doc: d }); setSavesKey((k) => k + 1); }}
          onError={setMessage}
        />
      )}
    </div>
  );
}
