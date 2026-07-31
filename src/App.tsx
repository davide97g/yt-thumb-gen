import { useEffect, useReducer, useRef, useState } from "react";
import { Download, Layers, Maximize2, PanelsTopLeft, Redo2, Settings, SlidersHorizontal, Undo2, X } from "lucide-react";
import { ThumbCanvas, type CropMode } from "./components/ThumbCanvas";
import { Inspector, BackgroundInspector, FormatSection } from "./components/Inspector";
import { LayerList } from "./components/LayerList";
import { SavesPanel } from "./components/SavesPanel";
import { ManageStarredDialog, StarredCommandDialog, StarredPanel } from "./components/StarredPanel";
import { ProjectHeader } from "./components/ProjectHeader";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { Toolbar } from "./components/Toolbar";
import { Field, Section } from "./components/controls";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { defaultFileName, exportThumb } from "./lib/export";
import { loadImageFile } from "./lib/loadImageFile";
import { getProject, getWorking, loadConfig, renameConfig, saveConfig, setProject, setWorking, starLayer } from "./lib/storage";
import { FORMATS, canvasSize, historyReducer, initHistory, newImageLayer, primaryId, type AppState, type FontKey, type Layer, type ThumbDoc } from "./state";
import { TEMPLATES } from "./presets";
import { useIsMobile } from "./lib/useIsMobile";
import { cn } from "./lib/utils";

const initial: AppState = { doc: TEMPLATES.dacoder(), selectedIds: [] };

/** The left rail's three collapsible sections. One is open at a time, so a long layer
 *  stack can't bury the archive under a page of scrolling. */
type RailSection = "layers" | "starred" | "saves";

export default function App() {
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
  const [manageStarredOpen, setManageStarredOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // `null` = every rail section collapsed, which is a legitimate state: the heads alone
  // are a compact table of contents.
  const [rail, setRail] = useState<RailSection | null>("layers");
  const toggleRail = (id: RailSection) => setRail((cur) => (cur === id ? null : id));
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // `null` = follow the project name (see `exportName`); a string is the user's override.
  // Clearing the field goes back to following the project.
  const [fileName, setFileName] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState<CropMode>(null);
  const [drawMode, setDrawMode] = useState(false);
  // Ephemeral font being hovered in the Font select — previewed on the selected text
  // layer without touching the doc/history until the user actually commits a choice.
  const [fontPreview, setFontPreview] = useState<FontKey | null>(null);

  // Live project identity for the working canvas: a name, its archive id (null
  // until first save), and when it was last saved. `savedDocRef` holds the doc as
  // of the last save/load — since the reducer makes a new doc on every edit, a
  // reference mismatch is a free "unsaved changes" check.
  const [projectName, setProjectName] = useState("Untitled");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedDocRef = useRef<ThumbDoc>(initial.doc);

  const { doc, selectedIds } = hist.present;
  const { w: CW, h: CH } = canvasSize(doc.format);
  const fmt = FORMATS[doc.format];
  const dirty = hydrated && doc !== savedDocRef.current;
  // The PNG is named after the open project unless the user typed something else, so
  // renaming the project (or opening another one) retargets the export for free.
  const exportName = fileName ?? defaultFileName(projectName);

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
  //
  // `?project=<id>` overrides that and opens a specific saved project instead. This is how
  // a link handed back by the MCP server lands the agent's design in front of the user.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("project");

    const open = wanted
      ? loadConfig(wanted).then((saved) =>
          adoptProject(saved.doc, saved.name, saved.id, saved.updatedAt)
        )
      : Promise.reject(new Error("no deep link"));

    // Falling back on failure matters: a stale or foreign id must not strand the editor.
    open
      .catch(() =>
        Promise.all([getWorking(), getProject()]).then(([d, p]) => {
          if (d) { savedDocRef.current = d; dispatch({ type: "loadDoc", doc: d }); }
          if (p) { setProjectName(p.name); setProjectId(p.id); }
          if (wanted) setMessage("Project not found.");
        })
      )
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

  // Mirror the open project's id into `?project=<id>` so the address bar is always
  // shareable: paste it anywhere and the editor reopens that exact design. Gated on
  // `hydrated` so it can't wipe an incoming deep link before it has been loaded, and
  // `replaceState` so opening projects doesn't stack up Back-button entries.
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    if (projectId) url.searchParams.set("project", projectId);
    else url.searchParams.delete("project");
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
      window.history.replaceState(null, "", next);
  }, [projectId, hydrated]);

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
      setMessage("Couldn't save.");
    }
  }

  // Star a layer straight from the layer list: uploads its images and saves it into
  // the per-account collection (see StarredPanel).
  async function starFromList(layer: Layer) {
    try {
      await starLayer(layer, undefined, { id: projectId, name: projectName });
      setStarredKey((k) => k + 1);
      setMessage(`“${layer.name}” added to favorites.`);
    } catch {
      setMessage("Couldn't save to favorites.");
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
      if (file.size > 8 * 1024 * 1024) { setMessage("Image too large (max 8 MB)"); return; }
      try {
        setMessage(null);
        dispatch({ type: "addLayer", layer: newImageLayer(await loadImageFile(file)) });
      } catch {
        setMessage("Couldn't paste the image.");
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
      setScale(Math.max(0.1, Math.min((el.clientWidth - padX) / CW, (el.clientHeight - padY) / CH)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile, CW, CH]);

  async function onExport() {
    if (!canvasRef.current) return;
    setExporting(true);
    setMessage(null);
    // Let `exporting` render commit first so the selection outline is hidden in capture.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    try {
      const { warning } = await exportThumb(canvasRef.current, exportName, { w: CW, h: CH, maxBytes: fmt.maxBytes, platform: fmt.platform });
      if (warning) setMessage(warning);
    } catch (err) {
      setMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
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
      <header className="flex h-[calc(3.5rem_+_env(safe-area-inset-top))] shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2.5">
          {/* Mobile: open the layers/project drawer. Desktop: toggle both rails. */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setMobileLeft(true)}
            title="Layers and project"
            aria-label="Open layers and project"
          >
            <Layers />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
            onClick={() => setChromeHidden((v) => !v)}
            title={chromeHidden ? "Show panels (\\)" : "Hide panels (\\)"}
            aria-label={chromeHidden ? "Show panels" : "Hide panels"}
            aria-pressed={chromeHidden}
          >
            {chromeHidden ? <Maximize2 /> : <PanelsTopLeft />}
          </Button>
          <span className="grid size-7 place-items-center rounded-md bg-primary/15 ring-1 ring-primary/25">
            <span className="size-2.5 rounded-full bg-primary" />
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight">Thumb Studio</div>
            <div className="readout text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{fmt.platform} · {CW}×{CH}</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2.5">
          {/* Undo/redo read as one instrument: a segmented pair, not two loose icons. */}
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-secondary/40 p-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => dispatch({ type: "undo" })}
              disabled={hist.past.length === 0}
              title="Undo (⌘Z)"
              aria-label="Undo"
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => dispatch({ type: "redo" })}
              disabled={hist.future.length === 0}
              title="Redo (⌘⇧Z)"
              aria-label="Redo"
            >
              <Redo2 />
            </Button>
          </div>
          {message && (
            <span
              className={`hidden max-w-64 truncate text-xs md:block ${message.startsWith("Export failed") ? "text-destructive" : "text-muted-foreground"}`}
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
            title="Properties"
            aria-label="Open properties"
          >
            <SlidersHorizontal />
          </Button>
          <Input
            className="readout hidden h-8 w-40 border-transparent bg-secondary/50 text-xs shadow-none md:block"
            value={exportName}
            onChange={(e) => setFileName(e.target.value || null)}
            placeholder={defaultFileName(projectName)}
            aria-label="File name"
          />
          <Button className="h-8" onClick={onExport} disabled={exporting}>
            <Download />
            <span className="hidden sm:inline">{exporting ? "Exporting…" : "Export PNG"}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            <Settings />
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
              "panel flex flex-col overflow-hidden border-r border-border",
              // mobile: off-canvas drawer (below the header, clear of the safe-area insets)
              "fixed left-[env(safe-area-inset-left)] top-[calc(3.5rem_+_env(safe-area-inset-top))] bottom-[env(safe-area-inset-bottom)] z-40 w-[86vw] max-w-xs shadow-2xl transition-transform duration-300 ease-out",
              mobileLeft ? "translate-x-0" : "-translate-x-full",
              // desktop: static rail in the flex row
              "md:static md:z-auto md:w-72 md:max-w-none md:shrink-0 md:translate-x-0 md:shadow-none md:transition-none",
              !isMobile && "anim-panel-l",
            )}
          >
            {/* Pinned head: the project never scrolls away — it's the context for
                everything below it. */}
            <div className="flex shrink-0 flex-col gap-4 p-4 pb-3">
              <DrawerClose label="Layers and project" onClose={() => setMobileLeft(false)} />

              {/* File name lives in the header on desktop; on mobile it moves in here. */}
              <div className="md:hidden">
                <Field label="File name">
                  <Input
                    value={exportName}
                    onChange={(e) => setFileName(e.target.value || null)}
                    placeholder={defaultFileName(projectName)}
                    aria-label="File name"
                  />
                </Field>
              </div>

              <ProjectHeader
                name={projectName}
                dirty={dirty}
                savedAt={savedAt}
                archived={projectId !== null}
                projectId={projectId}
                onRename={renameProject}
                onSave={() => void saveProject()}
                onNew={() => setNewOpen(true)}
              />
            </div>

            {/* One section open at a time: the open one takes the leftover height and
                scrolls inside itself, so the other heads are always one click away
                instead of hundreds of layers down. */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 px-4">
              <Section
                title="Layers"
                count={doc.layers.length}
                open={rail === "layers"}
                onToggle={() => toggleRail("layers")}
                fill
              >
                <LayerList layers={doc.layers} selectedIds={selectedIds} dispatch={dispatch} onStar={(l) => void starFromList(l)} />
              </Section>

              <StarredPanel
                dispatch={dispatch}
                onError={setMessage}
                refreshKey={starredKey}
                onChanged={() => setStarredKey((k) => k + 1)}
                onManage={() => setManageStarredOpen(true)}
                project={{ id: projectId, name: projectName }}
                open={rail === "starred"}
                onToggle={() => toggleRail("starred")}
              />

              <SavesPanel
                doc={doc}
                projectId={projectId}
                projectName={projectName}
                onLoad={adoptProject}
                onError={setMessage}
                refreshKey={savesKey}
                open={rail === "saves"}
                onToggle={() => toggleRail("saves")}
              />
            </div>

            {/* Discreet build stamp — tap-and-hold shows the build time. */}
            <div
              className="shrink-0 select-text px-4 py-2 text-center font-mono text-[10px] leading-none text-muted-foreground/35"
              title={`Build ${__BUILD_TIME__}`}
            >
              v{__APP_VERSION__} · {__APP_COMMIT__}
            </div>
          </aside>
        )}

        <main ref={previewRef} className="stage relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-3 md:p-8">
          {/* The canvas sits on the stage like a print on a table: small radius so the
              1280×720 frame stays honest, one hairline, one long soft shadow. */}
          <div
            className="overflow-hidden rounded-[6px] shadow-[0_40px_90px_-28px_oklch(0_0_0/85%)] ring-1 ring-white/12"
            style={{ width: CW * scale, height: CH * scale }}
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

          <div className="readout pointer-events-none absolute bottom-4 left-4 hidden text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/65 md:block">
            {CW} × {CH} · {Math.round(scale * 100)}%
          </div>

          {(isMobile || !chromeHidden) && (
            <div className="pointer-events-none absolute inset-x-2 bottom-3 flex justify-center md:inset-x-auto md:bottom-5 md:left-1/2 md:-translate-x-1/2">
              {/* `enabled` gates the dock's letter shortcuts: while a dialog is open the
                  keyboard belongs to it, or "T" would silently add a layer behind it. */}
              <Toolbar
                dispatch={dispatch}
                onError={setMessage}
                drawMode={drawMode}
                setDrawMode={setDrawMode}
                enabled={!newOpen && !cmdkOpen && !manageStarredOpen && !settingsOpen}
              />
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
            <DrawerClose label="Properties" onClose={() => setMobileRight(false)} />
            <FormatSection format={doc.format} dispatch={dispatch} />
            <Inspector selected={selected} selectedIds={selectedIds} layers={doc.layers} dispatch={dispatch} onError={setMessage} cropMode={cropMode} setCropMode={setCropMode} onFontPreview={setFontPreview} cw={CW} ch={CH} />
            <BackgroundInspector background={doc.background} dispatch={dispatch} onError={setMessage} />
          </aside>
        )}
      </div>

      <StarredCommandDialog open={cmdkOpen} onClose={() => setCmdkOpen(false)} dispatch={dispatch} onError={setMessage} />
      <ManageStarredDialog open={manageStarredOpen} onClose={() => setManageStarredOpen(false)} onError={setMessage} onChanged={() => setStarredKey((k) => k + 1)} />

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

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** Header for a mobile drawer: its title + a close button. Hidden on desktop,
    where the rails are always-on columns with no need to dismiss. */
function DrawerClose({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between md:hidden">
      <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close panel">
        <X />
      </Button>
    </div>
  );
}
