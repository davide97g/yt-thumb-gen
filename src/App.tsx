import { useEffect, useReducer, useRef, useState } from "react";
import { Download, Maximize2, PanelsTopLeft, Redo2, Undo2 } from "lucide-react";
import { CANVAS_H, CANVAS_W, ThumbCanvas, type CropMode } from "./components/ThumbCanvas";
import { Inspector, BackgroundInspector } from "./components/Inspector";
import { LayerList } from "./components/LayerList";
import { SavesPanel } from "./components/SavesPanel";
import { ProjectHeader } from "./components/ProjectHeader";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { Toolbar } from "./components/Toolbar";
import { Section } from "./components/controls";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { exportThumb } from "./lib/export";
import { loadImageFile } from "./lib/loadImageFile";
import { getProject, getWorking, renameConfig, saveConfig, setProject, setWorking } from "./lib/storage";
import { historyReducer, initHistory, newImageLayer, type AppState, type FontKey, type Layer, type ThumbDoc } from "./state";
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
  const [cropMode, setCropMode] = useState<CropMode>(null);
  const [drawMode, setDrawMode] = useState(false);
  // Ephemeral font being hovered in the Font select — previewed on the selected text
  // layer without touching the doc/history until the user actually commits a choice.
  const [fontPreview, setFontPreview] = useState<FontKey | null>(null);

  // Live project identity for the working canvas: a name, its archive id (null
  // until first save), and when it was last saved. `savedDocRef` holds the doc as
  // of the last save/load — since the reducer makes a new doc on every edit, a
  // reference mismatch is a free "unsaved changes" check.
  const [projectName, setProjectName] = useState("Senza titolo");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedDocRef = useRef<ThumbDoc>(initial.doc);

  const { doc, selectedId } = hist.present;
  const dirty = hydrated && doc !== savedDocRef.current;

  // Crop tooling is per-selection; drop it whenever the selected layer changes.
  useEffect(() => setCropMode(null), [selectedId]);
  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;

  // Canvas gets the doc with the hovered font swapped onto the selected text layer,
  // so the preview shows live without ever hitting the reducer/history.
  const viewDoc =
    fontPreview && selected?.type === "text"
      ? { ...doc, layers: doc.layers.map((l) => (l.id === selected.id ? { ...l, font: fontPreview } : l)) }
      : doc;

  // Latest doc/selection + a copy/paste clipboard, read by the global key handler
  // without rebinding it each render. Clipboard is a layer snapshot (immutable), so
  // it lives outside undo history and survives edits to the original.
  const selRef = useRef(selectedId);
  selRef.current = selectedId;
  const docRef = useRef(doc);
  docRef.current = doc;
  const clipboardRef = useRef<Layer | null>(null);

  // Hydrate working canvas + its project identity once on mount (falls back to
  // the seeded template). The hydrated doc becomes the clean baseline.
  useEffect(() => {
    Promise.all([getWorking(), getProject()])
      .then(([d, p]) => {
        if (d) { savedDocRef.current = d; dispatch({ type: "loadDoc", doc: d }); }
        if (p) { setProjectName(p.name); setProjectId(p.id); }
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // Autosave working canvas (debounced) once hydrated, so refresh never loses work.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => void setWorking(doc), 400);
    return () => clearTimeout(t);
  }, [doc, hydrated]);

  // Persist project identity (name + archive id) whenever it changes.
  useEffect(() => {
    if (!hydrated) return;
    void setProject({ name: projectName, id: projectId });
  }, [projectName, projectId, hydrated]);

  // ── Project actions ─────────────────────────────────────────────────────────
  // Load/import/create all funnel through `adoptProject`: clone the doc, make it
  // the clean baseline, set identity, and swap it into the editor.
  function adoptProject(d: ThumbDoc, name: string, id: string | null, at: number | null) {
    const fresh = structuredClone(d);
    savedDocRef.current = fresh;
    setProjectName(name);
    setProjectId(id);
    setSavedAt(at);
    setMessage(null);
    dispatch({ type: "loadDoc", doc: fresh });
  }

  async function saveProject() {
    try {
      const saved = await saveConfig(projectName, doc, projectId ?? undefined);
      savedDocRef.current = doc; // current edits are now the clean baseline
      setProjectId(saved.id);
      setSavedAt(saved.updatedAt);
      setSavesKey((k) => k + 1);
    } catch {
      setMessage("Salvataggio non riuscito.");
    }
  }

  function renameProject(name: string) {
    setProjectName(name);
    if (projectId) void renameConfig(projectId, name).then(() => setSavesKey((k) => k + 1));
  }

  // Latest save closure for the ⌘S handler, refreshed each render (see key handler).
  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => { if (dirty || !projectId) void saveProject(); };

  // Backspace / Delete removes the selected layer, unless focus is in a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘S / Ctrl+S saves the project — wins over the browser's "save page", even
      // while a field (e.g. the project name) is focused.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveRef.current(); return; }

      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return; // let inputs keep native undo / copy / paste

      if (e.key === "Escape") { setCropMode(null); setDrawMode(false); return; } // exit crop / draw mode

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

  // Paste an image from the clipboard as a new image layer. Skipped while a field
  // is focused so text paste into inputs stays native (same guard as the keydown handler).
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const file = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
      if (!file) return;
      e.preventDefault();
      if (file.size > 8 * 1024 * 1024) { setMessage("Foto troppo grande (max 8 MB)"); return; }
      try {
        setMessage(null);
        dispatch({ type: "addLayer", layer: newImageLayer(await loadImageFile(file)) });
      } catch {
        setMessage("Impossibile incollare l'immagine.");
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
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
            <ProjectHeader
              name={projectName}
              dirty={dirty}
              savedAt={savedAt}
              archived={projectId !== null}
              onRename={renameProject}
              onSave={() => void saveProject()}
              onNew={() => setNewOpen(true)}
            />

            <Section title="Livelli">
              <LayerList layers={doc.layers} selectedId={selectedId} dispatch={dispatch} />
            </Section>

            <SavesPanel
              doc={doc}
              projectId={projectId}
              projectName={projectName}
              onLoad={adoptProject}
              onError={setMessage}
              refreshKey={savesKey}
            />
          </aside>
        )}

        <main ref={previewRef} className="stage relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-8">
          <div
            className="overflow-hidden rounded-lg shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10"
            style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}
          >
            <ThumbCanvas
              doc={viewDoc}
              scale={scale}
              selectedId={selectedId}
              exporting={exporting}
              cropMode={cropMode}
              setCropMode={setCropMode}
              drawMode={drawMode}
              setDrawMode={setDrawMode}
              canvasRef={canvasRef}
              dispatch={dispatch}
            />
          </div>

          <div className="pointer-events-none absolute bottom-4 left-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
            1280 × 720 · {Math.round(scale * 100)}%
          </div>

          {!chromeHidden && (
            <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2">
              <Toolbar dispatch={dispatch} onError={setMessage} drawMode={drawMode} setDrawMode={setDrawMode} />
            </div>
          )}
        </main>

        {!chromeHidden && (
          <aside className="anim-panel-r panel panel-scroll flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border p-4">
            <Inspector selected={selected} dispatch={dispatch} onError={setMessage} cropMode={cropMode} setCropMode={setCropMode} onFontPreview={setFontPreview} />
            <BackgroundInspector background={doc.background} dispatch={dispatch} onError={setMessage} />
          </aside>
        )}
      </div>

      {newOpen && (
        <NewProjectDialog
          doc={doc}
          projectName={projectName}
          projectId={projectId}
          onClose={() => setNewOpen(false)}
          onCreated={(d, name, id, at) => { adoptProject(d, name, id, at); setSavesKey((k) => k + 1); }}
          onError={setMessage}
        />
      )}
    </div>
  );
}
