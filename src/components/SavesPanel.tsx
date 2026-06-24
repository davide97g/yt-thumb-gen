import { useEffect, useState, type Dispatch } from "react";
import { FileDown, FileUp, FolderOpen, Save, Trash2 } from "lucide-react";
import type { Action, ThumbDoc } from "../state";
import {
  deleteConfig,
  exportConfigFile,
  importConfigFile,
  listConfigs,
  saveConfig,
  type SavedConfig,
} from "../lib/storage";
import { Hint, Section, UploadButton } from "./controls";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Props = { doc: ThumbDoc; dispatch: Dispatch<Action>; onError: (msg: string) => void; refreshKey?: number };

export function SavesPanel({ doc, dispatch, onError, refreshKey }: Props) {
  const [configs, setConfigs] = useState<SavedConfig[]>([]);
  const [name, setName] = useState("");

  const refresh = () => listConfigs().then(setConfigs).catch(() => onError("Impossibile leggere i salvataggi."));
  useEffect(() => { void refresh(); }, [refreshKey]);

  async function onSave() {
    try {
      await saveConfig(name, structuredClone(doc));
      setName("");
      await refresh();
    } catch {
      onError("Salvataggio non riuscito.");
    }
  }

  async function onDelete(id: string) {
    await deleteConfig(id);
    await refresh();
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const { doc: imported } = await importConfigFile(file);
      dispatch({ type: "loadDoc", doc: imported });
      onError("");
    } catch {
      onError("File JSON non valido.");
    }
  }

  return (
    <Section title="Salvataggi">
      <div className="flex gap-2">
        <Input className="min-w-0" placeholder="Nome configurazione" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="secondary" size="sm" onClick={onSave}>
          <Save /> Salva
        </Button>
      </div>

      {configs.length > 0 ? (
        <div className="space-y-1">
          {configs.map((c) => (
            <div key={c.id} className="flex items-center gap-0.5">
              <Button variant="ghost" size="sm" className="flex-1 justify-start gap-2 px-2" title="Carica" onClick={() => dispatch({ type: "loadDoc", doc: structuredClone(c.doc) })}>
                <FolderOpen /> <span className="truncate">{c.name}</span>
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-7" title="Esporta JSON" onClick={() => exportConfigFile(c.doc, c.name)}>
                <FileDown />
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-7 hover:text-destructive" title="Elimina" onClick={() => void onDelete(c.id)}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <Hint>Nessun salvataggio ancora.</Hint>
      )}

      <div className="flex flex-col gap-2">
        <Button variant="outline" size="sm" className="w-full justify-center" onClick={() => exportConfigFile(doc, name || "grocerai-thumb")}>
          <FileDown /> Esporta JSON
        </Button>
        <UploadButton label="Importa JSON" icon={<FileUp />} accept="application/json,.json" className="w-full justify-center" onFile={(f) => void onImport(f)} />
      </div>
    </Section>
  );
}
