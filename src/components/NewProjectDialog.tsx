import { useState } from "react";
import { FilePlus, Save } from "lucide-react";
import type { ThumbDoc } from "../state";
import { saveConfig } from "../lib/storage";
import { SwitchRow } from "./controls";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Props = {
  doc: ThumbDoc; // the current working canvas
  projectName: string; // its live name (default for the "save current" step)
  projectId: string | null; // its archive id, so saving updates instead of duplicating
  onClose: () => void;
  onCreated: (doc: ThumbDoc, name: string, id: string, savedAt: number) => void; // App adopts it
  onError: (msg: string) => void;
};

/** "Nuovo progetto" flow: offer to save the current project, then create a new
 *  one (blank template or a clone of the current) and archive it. */
export function NewProjectDialog({ doc, projectName, projectId, onClose, onCreated, onError }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [prevName, setPrevName] = useState(projectName);
  const [newName, setNewName] = useState("Nuovo progetto");
  const [clone, setClone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function savePrevious() {
    setBusy(true);
    try {
      // Upsert by the live id so saving-before-new updates the project in place.
      await saveConfig(prevName, structuredClone(doc), projectId ?? undefined);
      setStep(2);
    } catch {
      onError("Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    try {
      const fresh: ThumbDoc = clone
        ? structuredClone(doc)
        : { background: { mode: "gradient", from: "#0d1b13", to: "#04070a", image: null, overlay: 0 }, layers: [] };
      const saved = await saveConfig(newName, structuredClone(fresh));
      onCreated(fresh, saved.name, saved.id, saved.updatedAt);
      onClose();
    } catch {
      onError("Creazione non riuscita.");
      setBusy(false);
    }
  }

  const submitOnEnter = (action: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !busy) { e.preventDefault(); action(); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onPointerDown={onClose}>
      <div
        className="anim-panel flex w-[min(440px,92vw)] flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Nuovo progetto</h3>
          <p className="text-sm text-muted-foreground">
            {step === 1
              ? "Salvare il progetto attuale prima di continuare?"
              : "Dai un nome al progetto e scegli da dove partire."}
          </p>
        </div>

        {step === 1 ? (
          <>
            <label className="space-y-1.5">
              <span className="text-sm text-muted-foreground">Nome del salvataggio</span>
              <Input value={prevName} autoFocus onChange={(e) => setPrevName(e.target.value)} onKeyDown={submitOnEnter(() => void savePrevious())} />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Annulla</Button>
              <Button variant="ghost" size="sm" onClick={() => setStep(2)} disabled={busy}>Non salvare</Button>
              <Button size="sm" onClick={() => void savePrevious()} disabled={busy}>
                <Save /> Salva e continua
              </Button>
            </div>
          </>
        ) : (
          <>
            <label className="space-y-1.5">
              <span className="text-sm text-muted-foreground">Nome del progetto</span>
              <Input value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={submitOnEnter(() => void create())} />
            </label>
            <SwitchRow label="Clona il progetto attuale" checked={clone} onChange={setClone} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} disabled={busy}>Indietro</Button>
              <Button size="sm" onClick={() => void create()} disabled={busy}>
                <FilePlus /> Crea
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
