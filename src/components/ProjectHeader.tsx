import { useEffect, useRef, useState } from "react";
import { Check, FilePlus, Pencil } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";

type Props = {
  name: string;
  /** doc has unsaved edits vs. the last save/load */
  dirty: boolean;
  /** epoch ms of the last save, or null if never archived */
  savedAt: number | null;
  /** never archived → Salva archives it even when not dirty */
  archived: boolean;
  onRename: (name: string) => void;
  onSave: () => void;
  onNew: () => void;
};

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

/** The live project's identity card — name, save state, and the primary
 *  "new project" action. The one place in the chrome that names the work. */
export function ProjectHeader({ name, dirty, savedAt, archived, onRename, onSave, onNew }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the field in sync when the project changes underneath us (load / new).
  useEffect(() => setDraft(name), [name]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    else setDraft(name);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(name);
    setEditing(false);
  };

  const canSave = dirty || !archived;
  const status = canSave
    ? archived
      ? "Modifiche non salvate"
      : "Da salvare"
    : savedAt
      ? `Salvato ${time(savedAt)}`
      : "Salvato";

  return (
    <div className="space-y-2.5">
      <div className="layer-accent rounded-lg border border-border bg-card/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Progetto
          </span>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-muted-foreground/60 transition-colors hover:text-foreground"
              title="Rinomina"
              aria-label="Rinomina progetto"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
        </div>

        {editing ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <Input
              ref={inputRef}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commit(); }
                if (e.key === "Escape") { e.preventDefault(); cancel(); }
              }}
              className="h-8"
            />
            <Button size="icon-sm" className="size-8 shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={commit} aria-label="Conferma nome">
              <Check />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-1 block w-full truncate text-left text-base font-semibold leading-snug tracking-tight text-foreground transition-colors hover:text-foreground/75"
            title={name}
          >
            {name || "Senza titolo"}
          </button>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                canSave ? "bg-primary shadow-[0_0_6px_var(--color-primary)]" : "bg-muted-foreground/40"
              )}
              aria-hidden
            />
            <span className="truncate">{status}</span>
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className={cn(
              "shrink-0 text-xs font-medium transition-colors",
              canSave ? "text-primary hover:text-primary/80" : "cursor-default text-muted-foreground/40"
            )}
            title="Salva nell'archivio (⌘S)"
          >
            Salva
          </button>
        </div>
      </div>

      <Button className="w-full justify-center" onClick={onNew}>
        <FilePlus /> Nuovo progetto
      </Button>
    </div>
  );
}
