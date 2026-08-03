import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Eye, FilePlus, History, Link2, Pencil } from "lucide-react";
import { GlowInput } from "./ui/glow-input";
import { HudLabel } from "./ui/hud-label";
import { QuackButton } from "./ui/quack-button";
import { StickerTooltip } from "./ui/sticker-tooltip";
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
  /** false for a guest: everything that persists is dropped, leaving the name and the
   *  read-only note. Renaming stays available because it's local until a save. */
  canWrite: boolean;
  onRename: (name: string) => void;
  onSave: () => void;
  onNew: () => void;
  /** Opens the version history. Only offered once the project has an archive id to have one. */
  onHistory: () => void;
};

/** Epoch ms → "14:32", or null if the value isn't a usable timestamp — the status line
 *  falls back to a plain "Saved" rather than printing "Invalid Date". */
function time(ms: number): string | null {
  const d = new Date(Number(ms));
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;
}

/** The live project's identity card — name, save state, and the primary
 *  "new project" action. The one place in the chrome that names the work. */
export function ProjectHeader({ name, dirty, savedAt, archived, projectId, canWrite, onRename, onSave, onNew, onHistory }: Props) {
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
          <HudLabel size="sm" tracking="tight" className="font-medium">
            Project
          </HudLabel>
          {!editing && (
            <span className="flex items-center gap-0.5">
              {projectId && canWrite && (
                <IconAction label="Version history" onClick={onHistory}>
                  <History className="size-3.5" />
                </IconAction>
              )}
              {projectId && (
                <IconAction label={copied ? "Link copied" : "Copy project link"} onClick={() => void copyLink()}>
                  {copied ? <Check className="size-3.5 text-primary" /> : <Link2 className="size-3.5" />}
                </IconAction>
              )}
              <IconAction label="Rename project" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
              </IconAction>
            </span>
          )}
        </div>

        {editing ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <GlowInput
              ref={inputRef}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commit(); }
                if (e.key === "Escape") { e.preventDefault(); cancel(); }
              }}
              aria-label="Project name"
              className="h-8"
            />
            <QuackButton
              size="icon-sm"
              className="shrink-0"
              onMouseDown={(e) => e.preventDefault()}
              onClick={commit}
              aria-label="Confirm name"
            >
              <Check />
            </QuackButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-1 block w-full truncate rounded-md text-left font-display text-base font-bold leading-snug tracking-tight text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={name}
          >
            {name || "Untitled"}
          </button>
        )}

        {/* A save state is only meaningful against an archive. A guest has none, so saying
            "Unsaved changes" next to a dead button would describe a problem they can't fix —
            the note says what's actually true instead. */}
        {canWrite ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            {/* The dot is duck's HUD status dot — square, and lime only when there is
                actually something to save. */}
            <HudLabel
              dot
              dotTone={canSave ? "primary" : "muted"}
              size="sm"
              tracking="tight"
              className="min-w-0 normal-case tracking-normal"
            >
              <span className="truncate">{status}</span>
            </HudLabel>
            <StickerTooltip content="Save to the archive (⌘S)" side="left" delay={400}>
              <QuackButton
                variant="ghost"
                size="sm"
                ripple={false}
                onClick={onSave}
                disabled={!canSave}
                className={cn("h-6 shrink-0 px-1.5 text-xs", canSave ? "text-primary" : "text-muted-foreground/40")}
              >
                Save
              </QuackButton>
            </StickerTooltip>
          </div>
        ) : (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Eye className="size-3.5 shrink-0" />
            <span className="truncate">Read-only — edits stay in this browser</span>
          </p>
        )}
      </div>

      {canWrite && (
        <QuackButton className="w-full" onClick={onNew}>
          <FilePlus /> New project
        </QuackButton>
      )}
    </div>
  );
}

/** The header's tiny icon buttons: a ghost QuackButton with its label in a tooltip
    rather than a `title` attribute, so the whole chrome labels itself the same way
    the dock does. */
function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <StickerTooltip content={label} delay={400}>
      <QuackButton
        variant="ghost"
        size="icon-xs"
        ripple={false}
        onClick={onClick}
        aria-label={label}
        className="size-6 text-muted-foreground/70"
      >
        {children}
      </QuackButton>
    </StickerTooltip>
  );
}
