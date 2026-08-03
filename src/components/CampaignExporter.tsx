import { useEffect, useRef, useState } from "react";
import { captureThumb, encodedBytes } from "../lib/export";
import { loadCampaign, loadConfig } from "../lib/storage";
import { safeFileName, uniqueName, zipStore, type ZipEntry } from "../lib/zip";
import { FORMATS, canvasSize, type ThumbDoc } from "../state";
import { ThumbCanvas } from "./ThumbCanvas";
import { StickerCard } from "./ui/sticker-card";
import { StickerProgress } from "./ui/sticker-progress";

type Props = {
  campaign: { id: string; name: string };
  onDone: (message: string | null) => void;
  onError: (message: string) => void;
};

/**
 * Downloads every design in a campaign as one ZIP.
 *
 * The whole point of a campaign is shipping one message across several platforms, which ends
 * in uploading five files to five places — and the only way to get them was to open each
 * design and press Export. So this renders each one *offscreen* and captures it exactly as a
 * normal export would.
 *
 * Offscreen means parked far to the left, not `display: none`: a hidden subtree has no
 * layout, and the background effects are WebGL that needs a real canvas to draw into. The
 * capture is the same `captureThumb` the Export button uses, so a YouTube design that has to
 * become a JPEG to fit 2 MB does so here too.
 */
export function CampaignExporter({ campaign, onDone, onError }: Props) {
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [current, setCurrent] = useState<ThumbDoc | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  // Resolved by the effect below once React has painted the document handed to `show()`.
  const paintedRef = useRef<() => void>(() => {});
  const cancelled = useRef(false);

  useEffect(() => {
    paintedRef.current();
  }, [current]);

  useEffect(() => {
    void run();
    return () => {
      cancelled.current = true;
    };
  }, [campaign.id]);

  /** Puts a document on the offscreen canvas and resolves once it has actually rendered. */
  const show = (doc: ThumbDoc) =>
    new Promise<void>((resolve) => {
      paintedRef.current = resolve;
      setCurrent(doc);
    });

  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

  async function run() {
    try {
      const full = await loadCampaign(campaign.id);
      if (full.designs.length === 0) {
        onDone("That campaign has no designs yet.");
        return;
      }
      setProgress({ done: 0, total: full.designs.length });

      const entries: ZipEntry[] = [];
      const taken = new Set<string>();
      const failed: string[] = [];

      for (const [i, design] of full.designs.entries()) {
        if (cancelled.current) return;
        try {
          // Fetched one at a time rather than all at once: the docs carry full-resolution
          // images inline, and a campaign of five would otherwise all sit in memory together.
          const saved = await loadConfig(design.id);
          await show(saved.doc);
          // Two frames plus the font gate: the first paints the layers, the second lets the
          // effect canvases draw, and a webfont still loading would capture as a fallback.
          await nextFrame();
          await nextFrame();
          await document.fonts.ready;

          const node = nodeRef.current;
          if (!node) throw new Error("offscreen canvas is missing");
          const fmt = FORMATS[saved.doc.format];
          const encoded = await captureThumb(node, {
            ...canvasSize(saved.doc.format),
            maxBytes: fmt.maxBytes,
            platform: fmt.platform,
          });
          entries.push({
            name: uniqueName(safeFileName(saved.name, encoded.kind === "png" ? "png" : "jpg"), taken),
            data: await encodedBytes(encoded),
          });
        } catch {
          // One bad design shouldn't cost the other four. It's named in the summary instead.
          failed.push(design.name);
        }
        setProgress({ done: i + 1, total: full.designs.length });
      }

      if (cancelled.current) return;
      if (entries.length === 0) {
        onError("Couldn't render any of the designs.");
        return;
      }

      const url = URL.createObjectURL(zipStore(entries));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeFileName(campaign.name, "zip")}`;
      a.click();
      URL.revokeObjectURL(url);

      onDone(
        failed.length
          ? `Exported ${entries.length} of ${entries.length + failed.length} designs — skipped ${failed.join(", ")}.`
          : `Exported ${entries.length} design${entries.length === 1 ? "" : "s"}.`
      );
    } catch {
      onError("Couldn't export the campaign.");
    }
  }

  const size = current ? canvasSize(current.format) : { w: 0, h: 0 };

  return (
    <>
      {/* Progress, so a five-design campaign doesn't look like a hung click. A real
          StickerProgress: determinate once the campaign has been read and the total is
          known, indeterminate (no `value`) while it is still being read. */}
      <div className="fixed inset-0 z-50 grid place-items-center bg-[oklch(0_0_0/0.65)] p-4 backdrop-blur-sm">
        <StickerCard className="w-[min(360px,92vw)] gap-3 text-center">
          <p className="font-display text-sm font-bold">Exporting “{campaign.name}”</p>
          <StickerProgress
            value={progress.total === 0 ? undefined : progress.done}
            max={progress.total || 1}
            label={
              progress.total === 0
                ? "Reading the campaign…"
                : `Rendering ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
            }
          />
        </StickerCard>
      </div>

      {/* The render stage. Parked offscreen rather than hidden, so it still lays out and the
          WebGL backgrounds still draw. `exporting` keeps selection chrome out of the capture. */}
      <div
        aria-hidden
        style={{ position: "fixed", left: -20000, top: 0, width: size.w, height: size.h, pointerEvents: "none", opacity: 0 }}
      >
        {current && (
          <ThumbCanvas
            doc={current}
            scale={1}
            selectedIds={[]}
            exporting
            cropMode={null}
            setCropMode={() => {}}
            drawMode={false}
            setDrawMode={() => {}}
            canvasRef={nodeRef}
            dispatch={() => {}}
          />
        )}
      </div>
    </>
  );
}
