import { useEffect, useState, type Dispatch } from "react";
import { Check, FolderInput, FolderOpen, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
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

type Props = {
  dispatch: Dispatch<Action>;
  onError: (msg: string) => void;
  refreshKey?: number; // bumped by App when something gets starred elsewhere
  onChanged: () => void; // bump the key so every consumer stays in sync
};

/** The starred-elements collection: any layer saved out of a project, searchable by
 *  name/type, re-insertable into the current canvas. Includes an importer that opens
 *  any archived project and lets you pull single layers from it. */
export function StarredPanel({ dispatch, onError, refreshKey, onChanged }: Props) {
  const [items, setItems] = useState<StarredMeta[]>([]);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const refresh = () => listStarred().then(setItems).catch(() => onError("Impossibile leggere i preferiti."));
  useEffect(() => { void refresh(); }, [refreshKey]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? items.filter((i) => i.name.toLowerCase().includes(q) || KIND_LABELS[i.kind].toLowerCase().includes(q))
    : items;

  // Insert = fetch the full layer (images re-hydrated) and add it as a fresh layer.
  async function onInsert(m: StarredMeta) {
    setBusyId(m.id);
    try {
      const { layer } = await loadStarred(m.id);
      dispatch({ type: "addLayer", layer: { ...layer, id: crypto.randomUUID() } });
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
        <Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground [&_svg]:size-3.5" title="Importa da un altro progetto" onClick={() => setImportOpen(true)}>
          <FolderInput />
        </Button>
      }
    >
      {items.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
                      <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                        {KIND_LABELS[m.kind]} · {relTime(m.updatedAt)}
                      </span>
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
        />
      )}
    </Section>
  );
}

/** Browse any archived project and pull single layers out of it: insert them straight
 *  into the current canvas, or star them into the collection. */
function ImportFromProjectDialog({
  onClose, onInsert, onStarred, onError,
}: { onClose: () => void; onInsert: (layer: Layer) => void; onStarred: () => void; onError: (msg: string) => void }) {
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
      await starLayer(layer);
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
