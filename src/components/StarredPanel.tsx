import { useEffect, useState, type Dispatch, type ReactNode } from "react";
import { Check, FolderInput, FolderOpen, ListFilter, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import { FONTS, FONT_STYLE, FONT_WEIGHT, type Action, type Layer, type LayerType, type TextLayer } from "../state";
import {
  type ConfigMeta,
  type StarredMeta,
  deleteStarred,
  detachLayer,
  listConfigs,
  listStarred,
  loadConfig,
  loadStarred,
  renameStarred,
  starLayer,
  useStarred,
} from "../lib/storage";
import { TYPE_ICON } from "./LayerList";
import { Section } from "./controls";
import { DuckCommand, type DuckCommandItemData } from "./ui/duck-command";
import { DuckTabs, DuckTabsList, DuckTabsTrigger } from "./ui/duck-tabs";
import { EmptyPond } from "./ui/empty-pond";
import { GlowInput } from "./ui/glow-input";
import { GlowSearch } from "./ui/glow-search";
import { HudLabel } from "./ui/hud-label";
import { QuackButton } from "./ui/quack-button";
import {
  StickerDialog,
  StickerDialogContent,
  StickerDialogDescription,
  StickerDialogFooter,
  StickerDialogHeader,
  StickerDialogTitle,
} from "./ui/sticker-dialog";
import { StickerTooltip } from "./ui/sticker-tooltip";
import { cn, relTime } from "@/lib/utils";

const KIND_LABELS: Record<LayerType, string> = {
  text: "Text",
  image: "Image",
  emoji: "Emoji",
  shape: "Shape",
  effect: "Effect",
  draw: "Drawing",
  emojifx: "Emoji effect",
};

/** Compact "39 s ago"-style age — the rail rows are too narrow for the full relTime. */
function shortTime(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}min ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Row subtitle: type + age, but skip the type when the name already is the type
 *  (a freshly starred "Image" would otherwise read "Image · Image"). */
function subtitle(m: StarredMeta): string {
  const age = shortTime(m.updatedAt);
  return m.name === KIND_LABELS[m.kind] ? age : `${KIND_LABELS[m.kind]} · ${age}`;
}

function filterStarred(items: StarredMeta[], query: string): StarredMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.name.toLowerCase().includes(q) || KIND_LABELS[i.kind].toLowerCase().includes(q));
}

/** A row's trailing action: ghost QuackButton with the ripple off (a dense list of them
    splashing is noise) and its label in a tooltip rather than a `title`. */
function RowIcon({
  label, onClick, disabled, className, children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <StickerTooltip content={label} delay={500}>
      <QuackButton
        variant="ghost"
        size="icon-xs"
        ripple={false}
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
        className={cn("shrink-0 text-muted-foreground", className)}
      >
        {children}
      </QuackButton>
    </StickerTooltip>
  );
}

type Props = {
  dispatch: Dispatch<Action>;
  onError: (msg: string) => void;
  refreshKey?: number; // bumped by App when something gets starred elsewhere
  onChanged: () => void; // bump the key so every consumer stays in sync
  onManage: () => void;
  project: { id: string | null; name: string };
  /** Accordion state, owned by the rail (see `App.tsx`). */
  open: boolean;
  onToggle: () => void;
};

/** The starred-elements collection: any layer saved out of a project, searchable by
 *  name/type, re-insertable into the current canvas. Includes an importer that opens
 *  any archived project and lets you pull single layers from it. */
export function StarredPanel({ dispatch, onError, refreshKey, onChanged, onManage, project, open, onToggle }: Props) {
  const [items, setItems] = useState<StarredMeta[]>([]);
  const [previews, setPreviews] = useState<Map<string, Layer>>(new Map());
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const refresh = async () => {
    try {
      const next = await listStarred();
      setItems(next);
      const layers = await Promise.all(next.map(async (item) => {
        try { return [item.id, (await loadStarred(item.id)).layer] as const; } catch { return null; }
      }));
      setPreviews(new Map(layers.filter((row): row is readonly [string, Layer] => row !== null)));
    } catch { onError("Couldn't read the favorites."); }
  };
  useEffect(() => { void refresh(); }, [refreshKey]);

  const visible = filterStarred(items, query);

  function closeSearch() {
    setQuery("");
    setSearchOpen(false);
  }

  // Insert = fetch the full layer (images re-hydrated) and add it as a fresh layer.
  async function onInsert(m: StarredMeta) {
    setBusyId(m.id);
    try {
      const { layer } = await loadStarred(m.id);
      dispatch({ type: "addLayer", layer: { ...layer, id: crypto.randomUUID() } });
      void useStarred(m.id);
      onError("");
    } catch {
      onError("Couldn't insert the element.");
    } finally {
      setBusyId(null);
    }
  }

  async function onRename(id: string) {
    try {
      await renameStarred(id, editName);
      setEditingId(null);
      await refresh();
    } catch {
      onError("Couldn't rename the element.");
    }
  }

  async function onDelete(id: string) {
    await deleteStarred(id).catch(() => onError("Couldn't delete the element."));
    await refresh();
  }

  return (
    <Section
      title="Favorites"
      count={items.length}
      open={open}
      onToggle={onToggle}
      fill
      action={
        <div className="flex items-center gap-0.5">
          {items.length > 0 && !searchOpen && (
            <RowIcon label="Search favorites (⌘K)" className="size-6" onClick={() => setSearchOpen(true)}>
              <Search />
            </RowIcon>
          )}
          <RowIcon label="Import from another project" className="size-6" onClick={() => setImportOpen(true)}>
            <FolderInput />
          </RowIcon>
          <RowIcon label="Manage favorites" className="size-6" onClick={onManage}>
            <ListFilter />
          </RowIcon>
        </div>
      }
    >
      {/* Search is collapsed into the header icon by default; the field appears on demand
          and folds away when it loses focus while empty (Esc always closes it). The
          filter is local, so `debounce={0}` — GlowSearch's own clear button flushes. */}
      {searchOpen && (
        <GlowSearch
          className="h-8"
          value={query}
          autoFocus
          debounce={0}
          onChange={(e) => setQuery(e.target.value)}
          onSearch={setQuery}
          onBlur={() => { if (!query.trim()) closeSearch(); }}
          onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }}
          placeholder="Search by name or type…"
          aria-label="Search favorites"
        />
      )}

      {items.length === 0 ? (
        <EmptyPond
          compact
          title="No favorites yet"
          hint="Star a layer to keep it here and reuse it in another project."
        />
      ) : visible.length === 0 ? (
        <EmptyPond compact title="No results" hint={`Nothing matches “${query.trim()}”.`} />
      ) : (
        <div className="space-y-0.5">
          {visible.map((m) => (
            <div key={m.id} className="group flex items-center gap-0.5 rounded-md transition-colors hover:bg-accent/40">
              {editingId === m.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-1 px-1 py-1">
                  <GlowInput
                    className="h-7 flex-1"
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void onRename(m.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    aria-label="New name"
                  />
                  <RowIcon label="Confirm" onClick={() => void onRename(m.id)}>
                    <Check />
                  </RowIcon>
                  <RowIcon label="Cancel" onClick={() => setEditingId(null)}>
                    <X />
                  </RowIcon>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left disabled:opacity-60"
                    title="Insert into the project"
                    disabled={busyId === m.id}
                    onClick={() => void onInsert(m)}
                  >
                    <FavoritePreview item={m} layer={previews.get(m.id)} compact />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm leading-tight">{m.name}</span>
                      <span className="block truncate text-[11px] leading-tight text-muted-foreground">{subtitle(m)}</span>
                    </span>
                    <Plus className={cn("size-4 shrink-0 text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100", busyId === m.id && "animate-pulse opacity-100")} />
                  </button>
                  <RowIcon
                    label="Rename"
                    className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    onClick={() => { setEditingId(m.id); setEditName(m.name); }}
                  >
                    <Pencil />
                  </RowIcon>
                  <RowIcon
                    label="Delete from favorites"
                    className="opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    onClick={() => void onDelete(m.id)}
                  >
                    <Trash2 />
                  </RowIcon>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {importOpen && (
        <ImportFromProjectDialog
          onClose={() => setImportOpen(false)}
          onInsert={(layer) => {
            dispatch({ type: "addLayer", layer: { ...detachLayer(layer), id: crypto.randomUUID() } });
            onError("");
          }}
          onStarred={() => { onChanged(); void refresh(); }}
          onError={onError}
          project={project}
        />
      )}
    </Section>
  );
}

/** A recognisable miniature of the saved layer.  Images retain their actual pixels;
 * text keeps its face, colour and background pill so scanning the library is visual. */
function FavoritePreview({ item, layer, compact = false }: { item: StarredMeta; layer?: Layer; compact?: boolean }) {
  const size = compact ? "h-9 w-11" : "h-14 w-20";
  const frame = "grid shrink-0 overflow-hidden rounded-md ring-1 ring-border";
  if (layer?.type === "image" && layer.src) {
    return <span className={cn(frame, "bg-black/20", size)}><img src={layer.src} alt="" className="h-full w-full object-cover" /></span>;
  }
  if (layer?.type === "text") {
    const text = layer as TextLayer;
    return (
      <span className={cn(frame, "bg-black/20 px-1 text-center", size)} style={{ backgroundColor: text.bg.enabled ? text.bg.color : undefined }}>
        <span className="min-w-0 self-center truncate leading-none" style={{ color: text.color, fontFamily: FONTS[text.font], fontWeight: FONT_WEIGHT[text.font], fontStyle: FONT_STYLE[text.font], letterSpacing: text.tracking ? `${text.tracking}em` : undefined, fontSize: compact ? 11 : 16 }}>
          {text.text.replace(/\n/g, " ")}
        </span>
      </span>
    );
  }
  return <span className={cn(frame, "place-items-center bg-secondary text-muted-foreground", size)}>{TYPE_ICON[item.kind]}</span>;
}

/** ⌘K palette: floating search over the starred collection. duck's own command palette —
 *  it owns the query, the ↑↓ roving, ↵ and Esc, so the only thing left here is turning
 *  starred metadata into items. `shortcut={false}` because App binds ⌘K itself and drives
 *  `open`; two bindings for one palette would fight. */
export function StarredCommandDialog({
  open, onClose, dispatch, onError,
}: { open: boolean; onClose: () => void; dispatch: Dispatch<Action>; onError: (msg: string) => void }) {
  const [items, setItems] = useState<StarredMeta[]>([]);

  useEffect(() => {
    if (!open) return;
    listStarred().then(setItems).catch(() => onError("Couldn't read the favorites."));
  }, [open]);

  async function insert(m: StarredMeta) {
    try {
      const { layer } = await loadStarred(m.id);
      dispatch({ type: "addLayer", layer: { ...layer, id: crypto.randomUUID() } });
      void useStarred(m.id);
      onError("");
    } catch {
      onError("Couldn't insert the element.");
    }
  }

  const entries: DuckCommandItemData[] = items.map((m) => ({
    value: m.id,
    label: m.name,
    hint: subtitle(m),
    // The palette matches on the label plus these, so typing "text" finds a text layer
    // whose name never says so.
    keywords: [KIND_LABELS[m.kind]],
    icon: TYPE_ICON[m.kind],
    onSelect: () => void insert(m),
  }));

  return (
    <DuckCommand
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      shortcut={false}
      items={entries}
      label="Favorites"
      description="Insert a saved element into the current project."
      placeholder="Search favorites by name or type…"
      emptyMessage={
        items.length === 0
          ? "No favorites yet. Star a layer to keep it here."
          : "Nothing matches that."
      }
    />
  );
}

/** A project-aware, removal-only view of the collection.  The compact rail stays
 * focused on insertion; this dialog is where ownership and cleanup are visible. */
export function ManageStarredDialog({
  open, onClose, onError, onChanged,
}: { open: boolean; onClose: () => void; onError: (msg: string) => void; onChanged: () => void }) {
  const [items, setItems] = useState<StarredMeta[]>([]);
  const [previews, setPreviews] = useState<Map<string, Layer>>(new Map());
  const [tab, setTab] = useState("all");
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const next = await listStarred();
      setItems(next);
      const layers = await Promise.all(next.map(async (item) => {
        try { return [item.id, (await loadStarred(item.id)).layer] as const; } catch { return null; }
      }));
      setPreviews(new Map(layers.filter((row): row is readonly [string, Layer] => row !== null)));
    }
    catch { onError("Couldn't read the favorites."); }
  };

  useEffect(() => {
    if (!open) return;
    setTab("all");
    void refresh();
  }, [open]);

  if (!open) return null;

  const projects = Array.from(
    items.reduce((map, item) => {
      if (item.sourceProjectName) map.set(item.sourceProjectId ?? `name:${item.sourceProjectName}`, item.sourceProjectName);
      return map;
    }, new Map<string, string>()),
  ).sort(([a], [b]) => {
    const aUse = Math.max(...items.filter((i) => (i.sourceProjectId ?? `name:${i.sourceProjectName}`) === a).map((i) => i.lastUsedAt));
    const bUse = Math.max(...items.filter((i) => (i.sourceProjectId ?? `name:${i.sourceProjectName}`) === b).map((i) => i.lastUsedAt));
    return bUse - aUse;
  });
  const tabs = [
    ["all", "All"], ["image", "Images"], ["text", "Text"],
    ...projects.map(([id, name]) => [`project:${id}`, name]),
  ];
  const visible = items.filter((item) => {
    if (tab === "all") return true;
    if (tab === "image" || tab === "text") return item.kind === tab;
    return `project:${item.sourceProjectId ?? `name:${item.sourceProjectName}`}` === tab;
  });

  async function remove(id: string) {
    setRemoving(id);
    try {
      await deleteStarred(id);
      setItems((current) => current.filter((item) => item.id !== id));
      onChanged();
    } catch {
      onError("Couldn't delete the element.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <StickerDialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <StickerDialogContent
        size="lg"
        className="h-[min(620px,82vh)] w-[min(720px,94vw)] max-w-none gap-0 overflow-hidden p-0"
        aria-label="Manage favorites"
      >
        <StickerDialogHeader className="border-b border-border px-5 py-4">
          <StickerDialogTitle>Manage favorites</StickerDialogTitle>
          <StickerDialogDescription>Organized by last use, type and source project.</StickerDialogDescription>
        </StickerDialogHeader>

        {/* DuckTabs implements the tabs keyboard pattern (arrows, Home, End) — the rail
            of filters used to be a hand-rolled `role="tablist"` with none of it. Only the
            list is used: the panel is one scroller shared by every filter. */}
        <DuckTabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
          <div className="shrink-0 overflow-x-auto border-b border-border px-3 py-2">
            <DuckTabsList aria-label="Filter favorites" className="min-w-max">
              {tabs.map(([id, label]) => (
                <DuckTabsTrigger key={id} value={id}>{label}</DuckTabsTrigger>
              ))}
            </DuckTabsList>
          </div>

          <div className="panel-scroll min-h-0 flex-1 overflow-y-auto p-3">
            {visible.length === 0 ? (
              <EmptyPond compact title="Nothing here" hint="No favorites in this collection." />
            ) : (
              <div className="divide-y divide-border/70">
                {visible.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-2 py-3">
                    <FavoritePreview item={item} layer={previews.get(item.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{KIND_LABELS[item.kind]} · {item.sourceProjectName ?? "No project"} · used {shortTime(item.lastUsedAt)}</span>
                    </span>
                    <RowIcon
                      label={`Remove ${item.name} from favorites`}
                      className="hover:text-destructive"
                      disabled={removing === item.id}
                      onClick={() => void remove(item.id)}
                    >
                      <Trash2 />
                    </RowIcon>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DuckTabs>

        <StickerDialogFooter className="shrink-0 items-center justify-between border-t border-border px-5 py-3 sm:justify-between">
          <HudLabel size="sm" tracking="tight">
            {visible.length} {visible.length === 1 ? "element" : "elements"}
          </HudLabel>
          <QuackButton variant="ghost" size="sm" onClick={onClose}>Close</QuackButton>
        </StickerDialogFooter>
      </StickerDialogContent>
    </StickerDialog>
  );
}

/** Browse any archived project and pull single layers out of it: insert them straight
 *  into the current canvas, or star them into the collection. */
function ImportFromProjectDialog({
  onClose, onInsert, onStarred, onError, project,
}: { onClose: () => void; onInsert: (layer: Layer) => void; onStarred: () => void; onError: (msg: string) => void; project: { id: string | null; name: string } }) {
  const [projects, setProjects] = useState<ConfigMeta[]>([]);
  const [openProject, setOpenProject] = useState<{ meta: ConfigMeta; layers: Layer[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // project id being loaded / layer id being starred
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set()); // feedback per layer row

  useEffect(() => {
    listConfigs().then(setProjects).catch(() => onError("Couldn't read the archive."));
  }, []);

  async function openOne(meta: ConfigMeta) {
    setBusy(meta.id);
    try {
      const full = await loadConfig(meta.id); // hydrated: layers carry paintable data URLs
      setOpenProject({ meta, layers: full.doc.layers });
    } catch {
      onError("Couldn't load the project.");
    } finally {
      setBusy(null);
    }
  }

  async function star(layer: Layer) {
    setBusy(layer.id);
    try {
      await starLayer(layer, undefined, openProject ? { id: openProject.meta.id, name: openProject.meta.name } : project);
      setStarredIds((s) => new Set(s).add(layer.id));
      onStarred();
    } catch {
      onError("Couldn't save to favorites.");
    } finally {
      setBusy(null);
    }
  }

  // Radix portals the panel to the body, which is also what fixed the old bug this
  // dialog carried its own portal for: `position: fixed` resolves against a
  // transformed ancestor, and the rail is transformed.
  return (
    <StickerDialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <StickerDialogContent size="sm" className="max-h-[80vh] w-[min(440px,92vw)] max-w-none">
        <StickerDialogHeader>
          <StickerDialogTitle>{openProject ? openProject.meta.name : "Import from a project"}</StickerDialogTitle>
          <StickerDialogDescription>
            {openProject
              ? "Insert an element into the current project, or save it to favorites."
              : "Pick the project to take elements from."}
          </StickerDialogDescription>
        </StickerDialogHeader>

        <div className="panel-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {!openProject ? (
            projects.length === 0 ? (
              <EmptyPond compact title="Nothing archived" hint="Save a project first, then import from it." />
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40 disabled:opacity-60"
                  disabled={busy === p.id}
                  onClick={() => void openOne(p)}
                >
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm leading-tight">{p.name}</span>
                    <span className="block truncate text-[11px] leading-tight text-muted-foreground">{relTime(p.updatedAt)}</span>
                  </span>
                </button>
              ))
            )
          ) : openProject.layers.length === 0 ? (
            <EmptyPond compact title="No layers" hint="This project is empty." />
          ) : (
            [...openProject.layers].reverse().map((layer) => (
              <div key={layer.id} className="group flex items-center gap-0.5 rounded-md transition-colors hover:bg-accent/40">
                <span className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5">
                  <span className="shrink-0 text-muted-foreground">{TYPE_ICON[layer.type]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm leading-tight">{layer.name}</span>
                    <span className="block truncate text-[11px] leading-tight text-muted-foreground">{KIND_LABELS[layer.type]}</span>
                  </span>
                </span>
                <RowIcon
                  label={starredIds.has(layer.id) ? "In favorites" : "Save to favorites"}
                  className={cn(starredIds.has(layer.id) && "text-primary")}
                  disabled={busy === layer.id}
                  onClick={() => void star(layer)}
                >
                  <Star className={cn(starredIds.has(layer.id) && "fill-current")} />
                </RowIcon>
                <RowIcon label="Insert into the current project" onClick={() => onInsert(layer)}>
                  <Plus />
                </RowIcon>
              </div>
            ))
          )}
        </div>

        <StickerDialogFooter>
          {openProject && (
            <QuackButton variant="ghost" size="sm" onClick={() => setOpenProject(null)}>Back</QuackButton>
          )}
          <QuackButton variant="ghost" size="sm" onClick={onClose}>Close</QuackButton>
        </StickerDialogFooter>
      </StickerDialogContent>
    </StickerDialog>
  );
}
