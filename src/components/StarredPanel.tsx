import { useEffect, useState, type Dispatch } from "react";
import { Check, FolderInput, FolderOpen, ListFilter, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import type { Action, Layer, LayerType } from "../state";
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
import { Hint, Section } from "./controls";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn, relTime } from "@/lib/utils";

const KIND_LABELS: Record<LayerType, string> = {
  text: "Testo",
  image: "Immagine",
  emoji: "Emoji",
  shape: "Forma",
  effect: "Effetto",
  draw: "Disegno",
  emojifx: "Effetto emoji",
};

/** Compact "39 s fa"-style age — the rail rows are too narrow for the full relTime. */
function shortTime(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s} s fa`;
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  if (s < 86400) return `${Math.round(s / 3600)} h fa`;
  return `${Math.round(s / 86400)} g fa`;
}

/** Row subtitle: type + age, but skip the type when the name already is the type
 *  (a freshly starred "Immagine" would otherwise read "Immagine · Immagine"). */
function subtitle(m: StarredMeta): string {
  const age = shortTime(m.updatedAt);
  return m.name === KIND_LABELS[m.kind] ? age : `${KIND_LABELS[m.kind]} · ${age}`;
}

function filterStarred(items: StarredMeta[], query: string): StarredMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.name.toLowerCase().includes(q) || KIND_LABELS[i.kind].toLowerCase().includes(q));
}

type Props = {
  dispatch: Dispatch<Action>;
  onError: (msg: string) => void;
  refreshKey?: number; // bumped by App when something gets starred elsewhere
  onChanged: () => void; // bump the key so every consumer stays in sync
  onManage: () => void;
  project: { id: string | null; name: string };
};

/** The starred-elements collection: any layer saved out of a project, searchable by
 *  name/type, re-insertable into the current canvas. Includes an importer that opens
 *  any archived project and lets you pull single layers from it. */
export function StarredPanel({ dispatch, onError, refreshKey, onChanged, onManage, project }: Props) {
  const [items, setItems] = useState<StarredMeta[]>([]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const refresh = () => listStarred().then(setItems).catch(() => onError("Impossibile leggere i preferiti."));
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
      onError("Impossibile inserire l'elemento.");
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
      onError("Impossibile rinominare l'elemento.");
    }
  }

  async function onDelete(id: string) {
    await deleteStarred(id).catch(() => onError("Impossibile eliminare l'elemento."));
    await refresh();
  }

  return (
    <Section
      title="Preferiti"
      action={
        <div className="flex items-center gap-0.5">
          {items.length > 0 && !searchOpen && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6 text-muted-foreground [&_svg]:size-3.5"
              title="Cerca nei preferiti (⌘K)"
              onClick={() => setSearchOpen(true)}
            >
              <Search />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground [&_svg]:size-3.5" title="Importa da un altro progetto" onClick={() => setImportOpen(true)}>
            <FolderInput />
          </Button>
          <Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground [&_svg]:size-3.5" title="Gestisci preferiti" onClick={onManage}>
            <ListFilter />
          </Button>
        </div>
      }
    >
      {/* Search is collapsed into the header icon by default; the input appears on demand
          and folds away when it loses focus while empty (Esc always closes it). */}
      {searchOpen && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => { if (!query.trim()) closeSearch(); }}
            onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }}
            placeholder="Cerca per nome o tipo…"
            aria-label="Cerca nei preferiti"
          />
        </div>
      )}

      {items.length === 0 ? (
        <Hint>
          Nessun preferito. Usa la <Star className="inline size-3 -translate-y-px" aria-label="stella" /> su un livello per salvarlo qui e riusarlo in altri progetti.
        </Hint>
      ) : visible.length === 0 ? (
        <Hint>Nessun risultato per «{query.trim()}».</Hint>
      ) : (
        <div className="space-y-0.5">
          {visible.map((m) => (
            <div key={m.id} className="group flex items-center gap-0.5 rounded-md transition-colors hover:bg-accent/40">
              {editingId === m.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-1 px-1 py-1">
                  <Input
                    className="h-7 flex-1"
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void onRename(m.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    aria-label="Nuovo nome"
                  />
                  <Button variant="ghost" size="icon-sm" className="size-7" title="Conferma" onClick={() => void onRename(m.id)}>
                    <Check />
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="size-7" title="Annulla" onClick={() => setEditingId(null)}>
                    <X />
                  </Button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left disabled:opacity-60"
                    title="Inserisci nel progetto"
                    disabled={busyId === m.id}
                    onClick={() => void onInsert(m)}
                  >
                    <span className="shrink-0 text-muted-foreground">{TYPE_ICON[m.kind]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm leading-tight">{m.name}</span>
                      <span className="block truncate text-[11px] leading-tight text-muted-foreground">{subtitle(m)}</span>
                    </span>
                    <Plus className={cn("size-4 shrink-0 text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100", busyId === m.id && "animate-pulse opacity-100")} />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    title="Rinomina"
                    onClick={() => { setEditingId(m.id); setEditName(m.name); }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    title="Elimina dai preferiti"
                    onClick={() => void onDelete(m.id)}
                  >
                    <Trash2 />
                  </Button>
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

/** ⌘K palette: floating search over the starred collection. Type to filter, ↑↓ to move,
 *  ↵ inserts the highlighted element into the current canvas, Esc closes. */
export function StarredCommandDialog({
  open, onClose, dispatch, onError,
}: { open: boolean; onClose: () => void; dispatch: Dispatch<Action>; onError: (msg: string) => void }) {
  const [items, setItems] = useState<StarredMeta[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    listStarred().then(setItems).catch(() => onError("Impossibile leggere i preferiti."));
  }, [open]);

  if (!open) return null;

  const visible = filterStarred(items, query);
  const idx = Math.min(active, Math.max(0, visible.length - 1));

  async function insert(m: StarredMeta) {
    setBusy(true);
    try {
      const { layer } = await loadStarred(m.id);
      dispatch({ type: "addLayer", layer: { ...layer, id: crypto.randomUUID() } });
      void useStarred(m.id);
      onError("");
      onClose();
    } catch {
      onError("Impossibile inserire l'elemento.");
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, visible.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return; }
    if (e.key === "Enter" && visible[idx] && !busy) { e.preventDefault(); void insert(visible[idx]); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/60 p-4 pt-[14vh]" onPointerDown={onClose}>
      <div
        className="anim-panel flex h-fit max-h-[60vh] w-[min(520px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="relative border-b border-border">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-12 w-full bg-transparent pl-10 pr-4 text-sm outline-none placeholder:text-muted-foreground"
            value={query}
            autoFocus
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKey}
            placeholder="Cerca un preferito per nome o tipo…"
            aria-label="Cerca nei preferiti"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <Hint>Nessun preferito. Usa la stella su un livello per salvarlo qui.</Hint>
          ) : visible.length === 0 ? (
            <p className="px-2.5 py-3 text-sm text-muted-foreground">Nessun risultato per «{query.trim()}».</p>
          ) : (
            visible.map((m, i) => (
              <button
                key={m.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                  i === idx ? "bg-accent" : "hover:bg-accent/50",
                  busy && "opacity-60",
                )}
                disabled={busy}
                onPointerMove={() => setActive(i)}
                onClick={() => void insert(m)}
              >
                <span className={cn("shrink-0", i === idx ? "text-primary" : "text-muted-foreground")}>{TYPE_ICON[m.kind]}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{subtitle(m)}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-3.5 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>↑↓ naviga</span>
          <span>↵ inserisci</span>
          <span>esc chiude</span>
        </div>
      </div>
    </div>
  );
}

/** A project-aware, removal-only view of the collection.  The compact rail stays
 * focused on insertion; this dialog is where ownership and cleanup are visible. */
export function ManageStarredDialog({
  open, onClose, onError, onChanged,
}: { open: boolean; onClose: () => void; onError: (msg: string) => void; onChanged: () => void }) {
  const [items, setItems] = useState<StarredMeta[]>([]);
  const [tab, setTab] = useState("all");
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = async () => {
    try { setItems(await listStarred()); }
    catch { onError("Impossibile leggere i preferiti."); }
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
    ["all", "Tutti"], ["image", "Immagini"], ["text", "Testi"],
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
      onError("Impossibile eliminare l'elemento.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onPointerDown={onClose}>
      <section className="anim-panel flex h-[min(620px,82vh)] w-[min(720px,94vw)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" onPointerDown={(e) => e.stopPropagation()} aria-label="Gestisci preferiti">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Gestisci preferiti</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Organizzati per ultimo utilizzo, tipo e progetto di origine.</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Chiudi"><X /></Button>
        </div>
        <div className="shrink-0 overflow-x-auto border-b border-border px-3 pt-2">
          <div className="flex min-w-max gap-1" role="tablist" aria-label="Filtra preferiti">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("rounded-t-md px-3 py-2 text-sm transition-colors", tab === id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {visible.length === 0 ? (
            <Hint>Nessun preferito in questa raccolta.</Hint>
          ) : (
            <div className="divide-y divide-border/70">
              {visible.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-2 py-3">
                  <span className="shrink-0 text-muted-foreground">{TYPE_ICON[item.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{KIND_LABELS[item.kind]} · {item.sourceProjectName ?? "Senza progetto"} · usato {shortTime(item.lastUsedAt)}</span>
                  </span>
                  <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground hover:text-destructive" title="Rimuovi dai preferiti" aria-label={`Rimuovi ${item.name} dai preferiti`} disabled={removing === item.id} onClick={() => void remove(item.id)}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span>{visible.length} {visible.length === 1 ? "elemento" : "elementi"}</span>
          <Button variant="ghost" size="sm" onClick={onClose}>Chiudi</Button>
        </div>
      </section>
    </div>
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
    listConfigs().then(setProjects).catch(() => onError("Impossibile leggere l'archivio."));
  }, []);

  async function openOne(meta: ConfigMeta) {
    setBusy(meta.id);
    try {
      const full = await loadConfig(meta.id); // hydrated: layers carry paintable data URLs
      setOpenProject({ meta, layers: full.doc.layers });
    } catch {
      onError("Impossibile caricare il progetto.");
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
      onError("Impossibile salvare nei preferiti.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onPointerDown={onClose}>
      <div
        className="anim-panel flex max-h-[80vh] w-[min(440px,92vw)] flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{openProject ? openProject.meta.name : "Importa da progetto"}</h3>
          <p className="text-sm text-muted-foreground">
            {openProject
              ? "Inserisci un elemento nel progetto attuale o salvalo nei preferiti."
              : "Scegli il progetto da cui prendere gli elementi."}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {!openProject ? (
            projects.length === 0 ? (
              <Hint>Nessun progetto in archivio.</Hint>
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
            <Hint>Questo progetto non ha livelli.</Hint>
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn("size-7", starredIds.has(layer.id) && "text-amber-400")}
                  title={starredIds.has(layer.id) ? "Nei preferiti" : "Salva nei preferiti"}
                  disabled={busy === layer.id}
                  onClick={() => void star(layer)}
                >
                  <Star className={cn(starredIds.has(layer.id) && "fill-current")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  title="Inserisci nel progetto attuale"
                  onClick={() => onInsert(layer)}
                >
                  <Plus />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end gap-2">
          {openProject && (
            <Button variant="ghost" size="sm" onClick={() => setOpenProject(null)}>Indietro</Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>Chiudi</Button>
        </div>
      </div>
    </div>
  );
}
