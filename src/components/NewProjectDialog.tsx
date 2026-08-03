import { useState } from "react";
import { FilePlus, Save } from "lucide-react";
import { DEFAULT_FORMAT, FORMATS, type FormatKey, type ThumbDoc } from "../state";
import { adaptDocToFormat } from "../lib/adapt";
import { saveConfig } from "../lib/storage";
import { SelectField, SwitchRow } from "./controls";
import { GlowField, GlowInput } from "./ui/glow-input";
import { QuackButton } from "./ui/quack-button";
import {
  StickerDialog,
  StickerDialogContent,
  StickerDialogDescription,
  StickerDialogFooter,
  StickerDialogHeader,
  StickerDialogTitle,
} from "./ui/sticker-dialog";

type Props = {
  doc: ThumbDoc; // the current working canvas
  projectName: string; // its live name (default for the "save current" step)
  projectId: string | null; // its archive id, so saving updates instead of duplicating
  onClose: () => void;
  onCreated: (doc: ThumbDoc, name: string, id: string, savedAt: number) => void; // App adopts it
  onError: (msg: string) => void;
};

/** "New project" flow: offer to save the current project, then create a new
 *  one (blank template or a clone of the current) and archive it. */
export function NewProjectDialog({ doc, projectName, projectId, onClose, onCreated, onError }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [prevName, setPrevName] = useState(projectName);
  const [newName, setNewName] = useState("New project");
  const [clone, setClone] = useState(false);
  const [format, setFormat] = useState<FormatKey>(DEFAULT_FORMAT);
  const [busy, setBusy] = useState(false);

  async function savePrevious() {
    setBusy(true);
    try {
      // Upsert by the live id so saving-before-new updates the project in place.
      await saveConfig(prevName, structuredClone(doc), projectId ?? undefined);
      setStep(2);
    } catch {
      onError("Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    try {
      const fresh: ThumbDoc = clone
        ? adaptDocToFormat(structuredClone(doc), format) // scale + recenter into the chosen format
        : { format, background: { mode: "gradient", from: "#0d1b13", to: "#04070a", image: null, overlay: 0 }, layers: [] };
      const saved = await saveConfig(newName, structuredClone(fresh));
      onCreated(fresh, saved.name, saved.id, saved.updatedAt);
      onClose();
    } catch {
      onError("Couldn't create the project.");
      setBusy(false);
    }
  }

  const submitOnEnter = (action: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !busy) { e.preventDefault(); action(); }
  };

  // Both steps' primary action is a request, so the button carries its own in-flight
  // state (`state="loading"`) instead of the dialog greying everything out.
  return (
    <StickerDialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <StickerDialogContent size="sm" className="w-[min(440px,92vw)] max-w-none">
        <StickerDialogHeader>
          <StickerDialogTitle>New project</StickerDialogTitle>
          <StickerDialogDescription>
            {step === 1
              ? "Save the current project before continuing?"
              : "Name the project and choose where to start from."}
          </StickerDialogDescription>
        </StickerDialogHeader>

        {step === 1 ? (
          <>
            <GlowField label="Save name">
              <GlowInput value={prevName} autoFocus onChange={(e) => setPrevName(e.target.value)} onKeyDown={submitOnEnter(() => void savePrevious())} />
            </GlowField>
            <StickerDialogFooter>
              <QuackButton variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</QuackButton>
              <QuackButton variant="ghost" size="sm" onClick={() => setStep(2)} disabled={busy}>Don't save</QuackButton>
              <QuackButton size="sm" state={busy ? "loading" : "idle"} loadingLabel="Saving…" onClick={() => void savePrevious()}>
                <Save /> Save and continue
              </QuackButton>
            </StickerDialogFooter>
          </>
        ) : (
          <>
            <GlowField label="Project name">
              <GlowInput value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={submitOnEnter(() => void create())} />
            </GlowField>
            <SelectField label="Format" value={format} options={Object.values(FORMATS).map((f) => ({ value: f.key, label: f.label }))} onChange={setFormat} />
            <SwitchRow label="Clone the current project" checked={clone} onChange={setClone} />
            <StickerDialogFooter>
              <QuackButton variant="ghost" size="sm" onClick={() => setStep(1)} disabled={busy}>Back</QuackButton>
              <QuackButton size="sm" state={busy ? "loading" : "idle"} loadingLabel="Creating…" onClick={() => void create()}>
                <FilePlus /> Create
              </QuackButton>
            </StickerDialogFooter>
          </>
        )}
      </StickerDialogContent>
    </StickerDialog>
  );
}
