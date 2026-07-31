import { useEffect, useRef, useState } from "react";
import { Check, FilePlus, Link2, Pencil } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";

type Props = {
  name: string;
  /** doc has unsaved edits vs. the last save/load */
  dirty: boolean;
  /** epoch ms of the last save, or null if never archived */
  savedAt: number | null;
  /** never archived → Save archives it even when not dirty */
  archived: boolean;
  /** archive id of the open project, or null before the first save — the shareable link */
  projectId: string | null;
  onRename: (name: string) => void;
  onSave: () => void;
  onNew: () => void;
};

/** Epoch ms → "14:32", or null if the value isn't a usable timestamp — the status line
 *  falls back to a plain "Saved" rather than printing "Invalid Date". */
function time(ms: number): string | null {
  const d = new Date(Number(ms));
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;
}

/** The live project's identity card — name, save state, and the primary
 *  "new project" action. The one place in the chrome that names the work. */
export function ProjectHeader({ name, dirty, savedAt, archived, projectId, onRename, onSave, onNew }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [copied, setCopied] = useState(false);
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

  // The link is built from the live URL, which already carries `?project=<id>` (App keeps
  // it in sync), so the id here is only a guard: no id, nothing shareable yet.
  const copyLink = async () => {
    if (!projectId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("project", projectId);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (non-secure context / denied) — the URL bar still shows the link.
    }
  };

  const canSave = dirty || !archived;
  const savedTime = savedAt === null ? null : time(savedAt);
  const status = canSave
    ? archived
      ? "Unsaved changes"
      : "Not saved yet"
    : savedTime
      ? `Saved ${savedTime}`
      : "Saved";

  return (
    <div className="space-y-2.5">
      {/* The one place elevation is earned: this block names the work, so it lifts
          off the rail. Everything else in the rail is hairlines. */}
      <div className="layer-accent rounded-lg border border-border bg-secondary/35 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Project
          </span>
          {!editing && (
            <span className="flex items-center gap-2">
              {projectId && (
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="text-muted-foreground/60 transition-colors hover:text-foreground"
                  title={copied ? "Link copied" : "Copy project link"}
                  aria-label="Copy project link"
                >
                  {copied ? <Check className="size-3.5 text-primary" /> : <Link2 className="size-3.5" />}
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-muted-foreground/60 transition-colors hover:text-foreground"
                title="Rename"
                aria-label="Rename project"
              >
                <Pencil className="size-3.5" />
              </button>
            </span>
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
            <Button size="icon-sm" className="size-8 shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={commit} aria-label="Confirm name">
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
            {name || "Untitled"}
          </button>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                canSave ? "bg-primary" : "bg-muted-foreground/40"
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
            title="Save to the archive (⌘S)"
          >
            Save
          </button>
        </div>
      </div>

      <Button className="w-full justify-center" onClick={onNew}>
        <FilePlus /> New project
      </Button>
    </div>
  );
}
