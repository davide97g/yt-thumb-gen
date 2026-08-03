import { useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { listVersions, restoreVersion, type VersionMeta } from "../lib/storage";
import { FORMATS, type ThumbDoc } from "../state";
import { DuckSpinner } from "./ui/duck-spinner";
import { EmptyPond } from "./ui/empty-pond";
import { HudLabel } from "./ui/hud-label";
import { QuackButton } from "./ui/quack-button";
import {
  StickerDialog,
  StickerDialogContent,
  StickerDialogHeader,
  StickerDialogTitle,
} from "./ui/sticker-dialog";
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

  // Escape, the focus trap and the scroll lock come from Radix via StickerDialog. This
  // component used to bind Escape itself and had neither of the other two.
  return (
    <StickerDialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <StickerDialogContent size="sm" className="max-h-[70vh] w-full max-w-md" aria-label="Version history">
        <StickerDialogHeader>
          <StickerDialogTitle className="sr-only">Version history</StickerDialogTitle>
          <HudLabel size="sm" tracking="tight" className="flex items-center gap-2 font-medium">
            <History className="size-3.5" /> History
          </HudLabel>
        </StickerDialogHeader>

        {versions === null ? (
          <div className="grid place-items-center py-6">
            <DuckSpinner size="sm" label="Reading the history" />
          </div>
        ) : versions.length === 0 ? (
          <EmptyPond
            compact
            title="No history yet"
            hint="Every save that changes the design files the previous one here."
          />
        ) : (
          <ul className="panel-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
            {versions.map((v) => (
              <li key={v.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/40">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] leading-tight">{v.name}</span>
                  <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                    {relTime(v.createdAt)} · {v.layerCount} layer{v.layerCount === 1 ? "" : "s"}
                    {v.format && FORMATS[v.format] ? ` · ${FORMATS[v.format].label}` : ""}
                  </span>
                </span>
                {/* One restore at a time: the row that fired it shows the progress, the
                    others just stop being clickable. */}
                <QuackButton
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  disabled={busy !== null && busy !== v.id}
                  state={busy === v.id ? "loading" : "idle"}
                  loadingLabel="Restoring…"
                  onClick={() => void restore(v)}
                >
                  <RotateCcw /> Restore
                </QuackButton>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[10.5px] leading-snug text-muted-foreground/70">
          Restoring is itself a save — the design being replaced becomes the newest entry, so nothing is lost by trying one.
        </p>
      </StickerDialogContent>
    </StickerDialog>
  );
}
