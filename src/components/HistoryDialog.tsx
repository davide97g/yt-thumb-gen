import { useEffect, useState } from "react";
import { History, RotateCcw, X } from "lucide-react";
import { listVersions, restoreVersion, type VersionMeta } from "../lib/storage";
import { FORMATS, type ThumbDoc } from "../state";
import { Button } from "./ui/button";
import { relTime } from "@/lib/utils";

type Props = {
  projectId: string;
  /** Warn before discarding edits that were never saved — they aren't in the history. */
  dirty: boolean;
  onClose: () => void;
  onRestored: (doc: ThumbDoc, at: number) => void;
  onError: (msg: string) => void;
};

/** Past versions of the open project, newest first, each one restorable.
 *
 *  The list is what the backend filed on every save that changed something — so it reads as
 *  "the design as it was before that save", which is what someone reaching for history
 *  actually wants back. */
export function HistoryDialog({ projectId, dirty, onClose, onRestored, onError }: Props) {
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    listVersions(projectId)
      .then(setVersions)
      .catch(() => {
        onError("Couldn't read the history.");
        onClose();
      });
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function restore(v: VersionMeta) {
    // Unsaved edits are the one thing history can't give back, so they're worth a question.
    if (dirty && !confirm("You have unsaved changes. Restoring replaces them. Continue?")) return;
    setBusy(v.id);
    try {
      const { doc, updatedAt } = await restoreVersion(projectId, v.id);
      onRestored(doc, updatedAt);
      onClose();
    } catch {
      onError("Couldn't restore that version.");
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="panel flex max-h-[70vh] w-full max-w-md flex-col gap-3 rounded-xl border border-border p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Version history"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            <History className="size-3.5" /> History
          </span>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        {versions === null ? (
          <p className="text-[11.5px] text-muted-foreground">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            No history yet. Every save that changes the design files the previous one here.
          </p>
        ) : (
          <ul className="panel-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
            {versions.map((v) => (
              <li key={v.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] leading-tight">{v.name}</span>
                  <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                    {relTime(v.createdAt)} · {v.layerCount} layer{v.layerCount === 1 ? "" : "s"}
                    {v.format && FORMATS[v.format] ? ` · ${FORMATS[v.format].label}` : ""}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  disabled={busy !== null}
                  onClick={() => void restore(v)}
                >
                  <RotateCcw /> {busy === v.id ? "Restoring…" : "Restore"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[10.5px] leading-snug text-muted-foreground/70">
          Restoring is itself a save — the design being replaced becomes the newest entry, so nothing is lost by trying one.
        </p>
      </div>
    </div>
  );
}
