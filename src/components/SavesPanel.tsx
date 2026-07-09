import { useEffect, useState } from "react";
import { FileDown, FileUp, FolderOpen, Trash2 } from "lucide-react";
import type { ThumbDoc } from "../state";
import {
  deleteConfig,
  exportConfigFile,
  importConfigFile,
  listConfigs,
  type SavedConfig,
} from "../lib/storage";
import { Hint, Section, UploadButton } from "./controls";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

type Props = {
  doc: ThumbDoc; // current working canvas, for "export current"
  projectId: string | null; // which archived project is live, if any
  projectName: string; // live name, mirrored onto the active row
  onLoad: (doc: ThumbDoc, name: string, id: string | null, savedAt: number | null) => void;
  onError: (msg: string) => void;
  refreshKey?: number;
};

const rtf = new Intl.RelativeTimeFormat("it", { numeric: "auto" });
function relTime(ts: number): string {
  const s = Math.round((ts - Date.now()) / 1000);
  const a = Math.abs(s);
  if (a < 60) return rtf.format(Math.round(s), "second");
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

/** The project library: every named save, newest first. The live project (if it
 *  was loaded from here) is pinned visually and shows its current name. */
export function SavesPanel({ doc, projectId, projectName, onLoad, onError, refreshKey }: Props) {
  const [configs, setConfigs] = useState<SavedConfig[]>([]);

  const refresh = () => listConfigs().then(setConfigs).catch(() => onError("Impossibile leggere l'archivio."));
  useEffect(() => { void refresh(); }, [refreshKey]);

  async function onDelete(id: string) {
    await deleteConfig(id);
    await refresh();
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const { name, doc: imported } = await importConfigFile(file);
      onLoad(imported, name ?? "Senza titolo", null, null);
      onError("");
    } catch {
      onError("File JSON non valido.");
    }
  }

  return (
    <Section title="Archivio">
      {configs.length > 0 ? (
        <div className="space-y-0.5">
          {configs.map((c) => {
            const active = c.id === projectId;
            return (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-0.5 rounded-md transition-colors",
                  active ? "layer-accent bg-accent/50" : "hover:bg-accent/40"
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left"
                  title={active ? "Progetto attuale" : "Carica"}
                  onClick={() => onLoad(c.doc, c.name, c.id, c.updatedAt)}
                >
                  <FolderOpen className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm leading-tight">{active ? projectName : c.name}</span>
                    <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                      {active ? "In uso" : relTime(c.updatedAt)}
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  title="Esporta JSON"
                  onClick={() => exportConfigFile(c.doc, c.name)}
                >
                  <FileDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  title="Elimina"
                  onClick={() => void onDelete(c.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <Hint>Nessun progetto in archivio. <span className="text-foreground">Salva</span> per archiviare quello attuale.</Hint>
      )}

      <div className="flex flex-col gap-2 pt-1">
        <Button variant="outline" size="sm" className="w-full justify-center" onClick={() => exportConfigFile(doc, projectName || "thumb")}>
          <FileDown /> Esporta progetto
        </Button>
        <UploadButton label="Importa da file" icon={<FileUp />} accept="application/json,.json" className="w-full justify-center" onFile={(f) => void onImport(f)} />
      </div>
    </Section>
  );
}
