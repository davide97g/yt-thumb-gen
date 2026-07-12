import { useEffect, useReducer, useRef, useState } from "react";
import { Download, Layers, LogOut, Maximize2, PanelsTopLeft, Redo2, SlidersHorizontal, Undo2, X } from "lucide-react";
import { CANVAS_H, CANVAS_W, ThumbCanvas, type CropMode } from "./components/ThumbCanvas";
import { Inspector, BackgroundInspector } from "./components/Inspector";
import { LayerList } from "./components/LayerList";
import { SavesPanel } from "./components/SavesPanel";
import { StarredCommandDialog, StarredPanel } from "./components/StarredPanel";
import { ProjectHeader } from "./components/ProjectHeader";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { useAuth } from "./components/AuthGate";
import { Toolbar } from "./components/Toolbar";
import { Field, Section } from "./components/controls";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { exportThumb } from "./lib/export";
import { loadImageFile } from "./lib/loadImageFile";
import { getProject, getWorking, renameConfig, saveConfig, setProject, setWorking, starLayer } from "./lib/storage";
import { historyReducer, initHistory, newImageLayer, primaryId, type AppState, type FontKey, type Layer, type ThumbDoc } from "./state";
import { TEMPLATES } from "./presets";
import { useIsMobile } from "./lib/useIsMobile";
import { cn } from "./lib/utils";

const initial: AppState = { doc: TEMPLATES.dacoder(), selectedIds: [] };

export default function App() {
  const { logout } = useAuth();
  const [hist, dispatch] = useReducer(historyReducer, initial, initHistory);
  const [hydrated, setHydrated] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [chromeHidden, setChromeHidden] = useState(false);
  const isMobile = useIsMobile();
  // Off-canvas panels for the mobile shell — the two side rails become icon-triggered drawers.
  const [mobileLeft, setMobileLeft] = useState(false);
  const [mobileRight, setMobileRight] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [savesKey, setSavesKey] = useState(0);
  const [starredKey, setStarredKey] = useState(0);
  const [cmdkOpen, setCmdkOpen] = useState(false);
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

  const { doc, selectedIds } = hist.present;
  const dirty = hydrated && doc !== savedDocRef.current;

  const primary = primaryId(hist.present);
  // Crop tooling is per-selection; drop it whenever the selected layer changes.
  useEffect(() => setCropMode(null), [primary]);
  const selected = doc.layers.find((l) => l.id === primary) ?? null;

  // Canvas gets the doc with the hovered font swapped onto the selected text layer,
  // so the preview shows live without ever hitting the reducer/history.
  const viewDoc =
    fontPreview && selected?.type === "text"
      ? { ...doc, layers: doc.layers.map((l) => (l.id === selected.id ? { ...l, font: fontPreview } : l)) }
      : doc;

  // Latest doc/selection + a copy/paste clipboard, read by the global key handler
  // without rebinding it each render. Clipboard is a layer snapshot (immutable), so
  // it lives outside undo history and survives edits to the original.
  const selRef = useRef(selectedIds);
  selRef.current = selectedIds;
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

  // Star a layer straight from the layer list: uploads its images and saves it into
  // the per-account collection (see StarredPanel).
  async function starFromList(layer: Layer) {
    try {
      await starLayer(layer);
      setStarredKey((k) => k + 1);
      setMessage(`«${layer.name}» aggiunto ai preferiti.`);
    } catch {
      setMessage("Impossibile salvare nei preferiti.");
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
      // ⌘K / Ctrl+K opens the starred-elements palette — like ⌘S, it also fires while typing.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdkOpen(true); return; }

      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return; // let inputs keep native undo / copy / paste

      if (e.key === "Escape") { setCropMode(null); setDrawMode(false); return; } // exit crop / draw mode

      const mod = e.metaKey || e.ctrlKey;
      if (mod) {
        const k = e.key.toLowerCase();
        if (k === "z") { e.preventDefault(); dispatch(e.shiftKey ? { type: "redo" } : { type: "undo" }); return; }
        if (k === "y") { e.preventDefault(); dispatch({ type: "redo" }); return; } // Windows redo
        if (k === "c") { const l = docRef.current.layers.find((x) => x.id === selRef.current[selRef.current.length - 1]); if (l) clipboardRef.current = l; return; }
        if (k === "v" && clipboardRef.current) { e.preventDefault(); dispatch({ type: "pasteLayer", layer: clipboardRef.current }); return; }
        if (k === "g") {
          e.preventDefault();
          if (e.shiftKey) {
            if (selRef.current.length) dispatch({ type: "ungroup", ids: selRef.current });
          } else if (selRef.current.length >= 2) {
            dispatch({ type: "group", ids: selRef.current });
          }
          return;
        }
        return;
      }
      // "\" toggles all chrome (rails + dock) for a full-bleed preview.
      if (e.key === "\\") { e.preventDefault(); setChromeHidden((v) => !v); return; }
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (selRef.current.length) dispatch({ type: "removeLayers", ids: selRef.current });
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

  // Leaving mobile width: drop any open drawers so the desktop rails aren't shadowed.
  useEffect(() => {
    if (!isMobile) { setMobileLeft(false); setMobileRight(false); }
  }, [isMobile]);

  // Fit the canvas to the stage, leaving room for the floating dock + readout.
  // Mobile trims the padding so the 1280×720 frame stays as large as the screen allows
  // (largest in landscape — hence the manifest's landscape orientation hint).
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const padX = isMobile ? 24 : 80;
      const padY = isMobile ? 96 : 150;
      setScale(Math.max(0.1, Math.min((el.clientWidth - padX) / CANVAS_W, (el.clientHeight - padY) / CANVAS_H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);

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
    <div
      className="flex h-full flex-col bg-background text-foreground"
      // iOS standalone PWA draws under the notch/home indicator (viewport-fit=cover).
      // Keep the body clear of the side notches + home indicator; the header owns the
      // top inset itself so its bar fills the status-bar area.
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="flex h-[calc(3.5rem_+_env(safe-area-inset-top))] shrink-0 items-center justify-between gap-4 border-b border-border bg-card/40 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="flex items-center gap-2.5">
          {/* Mobile: open the layers/project drawer. Desktop: toggle both rails. */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setMobileLeft(true)}
            title="Livelli e progetto"
            aria-label="Apri livelli e progetto"
          >
            <Layers />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
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

        <div className="flex items-center gap-1.5 md:gap-2.5">
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
          {/* Mobile: open the properties/inspector drawer. */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setMobileRight(true)}
            title="Proprietà"
            aria-label="Apri proprietà"
          >
            <SlidersHorizontal />
          </Button>
          <Input
            className="hidden h-8 w-40 md:block"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="thumb.png"
            aria-label="Nome file"
          />
          <Button className="h-8" onClick={onExport} disabled={exporting}>
            <Download />
            <span className="hidden sm:inline">{exporting ? "Esporto…" : "Esporta PNG"}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => void logout()}
            title="Esci"
            aria-label="Esci"
          >
            <LogOut />
          </Button>
        </div>
      </header>

      {/* ── Body: left rail · stage · inspector ───────────────────────────
          On desktop the two rails sit in the flex row (toggled by `chromeHidden`).
          On mobile they become off-canvas drawers over the stage, opened from the
          header icons and dismissed by the backdrop or their own close button. */}
      <div className="relative flex min-h-0 flex-1">
        {/* Backdrop behind an open mobile drawer. */}
        {isMobile && (mobileLeft || mobileRight) && (
          <div
            className="absolute inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => { setMobileLeft(false); setMobileRight(false); }}
            aria-hidden
          />
        )}

        {(isMobile || !chromeHidden) && (
          <aside
            className={cn(
              "panel panel-scroll flex flex-col gap-5 overflow-y-auto border-r border-border p-4",
              // mobile: off-canvas drawer (below the header, clear of the safe-area insets)
              "fixed left-[env(safe-area-inset-left)] top-[calc(3.5rem_+_env(safe-area-inset-top))] bottom-[env(safe-area-inset-bottom)] z-40 w-[86vw] max-w-xs shadow-2xl transition-transform duration-300 ease-out",
              mobileLeft ? "translate-x-0" : "-translate-x-full",
              // desktop: static rail in the flex row
              "md:static md:z-auto md:w-64 md:max-w-none md:shrink-0 md:translate-x-0 md:shadow-none md:transition-none",
              !isMobile && "anim-panel-l",
            )}
          >
            <DrawerClose label="Livelli e progetto" onClose={() => setMobileLeft(false)} />

            {/* File name lives in the header on desktop; on mobile it moves in here. */}
            <div className="md:hidden">
              <Field label="Nome file">
                <Input
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="thumb.png"
                  aria-label="Nome file"
                />
              </Field>
            </div>

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
              <LayerList layers={doc.layers} selectedIds={selectedIds} dispatch={dispatch} onStar={(l) => void starFromList(l)} />
            </Section>

            <StarredPanel
              dispatch={dispatch}
              onError={setMessage}
              refreshKey={starredKey}
              onChanged={() => setStarredKey((k) => k + 1)}
            />

            <SavesPanel
              doc={doc}
              projectId={projectId}
              projectName={projectName}
              onLoad={adoptProject}
              onError={setMessage}
              refreshKey={savesKey}
            />

            {/* Discreet build stamp — tap-and-hold shows the build time. */}
            <div
              className="mt-auto shrink-0 select-text pt-1 text-center font-mono text-[10px] leading-none text-muted-foreground/35"
              title={`Build ${__BUILD_TIME__}`}
            >
              v{__APP_VERSION__} · {__APP_COMMIT__}
            </div>
          </aside>
        )}

        <main ref={previewRef} className="stage relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-3 md:p-8">
          <div
            className="overflow-hidden rounded-lg shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10"
            style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}
          >
            <ThumbCanvas
              doc={viewDoc}
              scale={scale}
              selectedIds={selectedIds}
              exporting={exporting}
              cropMode={cropMode}
              setCropMode={setCropMode}
              drawMode={drawMode}
              setDrawMode={setDrawMode}
              canvasRef={canvasRef}
              dispatch={dispatch}
            />
          </div>

          <div className="pointer-events-none absolute bottom-4 left-4 hidden font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80 md:block">
            1280 × 720 · {Math.round(scale * 100)}%
          </div>

          {(isMobile || !chromeHidden) && (
            <div className="pointer-events-none absolute inset-x-2 bottom-3 flex justify-center md:inset-x-auto md:bottom-5 md:left-1/2 md:-translate-x-1/2">
              <Toolbar dispatch={dispatch} layers={doc.layers} onError={setMessage} drawMode={drawMode} setDrawMode={setDrawMode} />
            </div>
          )}
        </main>

        {(isMobile || !chromeHidden) && (
          <aside
            className={cn(
              "panel panel-scroll flex flex-col gap-5 overflow-y-auto border-l border-border p-4",
              // mobile: off-canvas drawer (below the header, clear of the safe-area insets)
              "fixed right-[env(safe-area-inset-right)] top-[calc(3.5rem_+_env(safe-area-inset-top))] bottom-[env(safe-area-inset-bottom)] z-40 w-[86vw] max-w-xs shadow-2xl transition-transform duration-300 ease-out",
              mobileRight ? "translate-x-0" : "translate-x-full",
              // desktop: static rail in the flex row
              "md:static md:z-auto md:w-80 md:max-w-none md:shrink-0 md:translate-x-0 md:shadow-none md:transition-none",
              !isMobile && "anim-panel-r",
            )}
          >
            <DrawerClose label="Proprietà" onClose={() => setMobileRight(false)} />
            <Inspector selected={selected} selectedIds={selectedIds} layers={doc.layers} dispatch={dispatch} onError={setMessage} cropMode={cropMode} setCropMode={setCropMode} onFontPreview={setFontPreview} />
            <BackgroundInspector background={doc.background} dispatch={dispatch} onError={setMessage} />
          </aside>
        )}
      </div>

      <StarredCommandDialog open={cmdkOpen} onClose={() => setCmdkOpen(false)} dispatch={dispatch} onError={setMessage} />

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

/** Header for a mobile drawer: its title + a close button. Hidden on desktop,
    where the rails are always-on columns with no need to dismiss. */
function DrawerClose({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between md:hidden">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Chiudi pannello">
        <X />
      </Button>
    </div>
  );
}
