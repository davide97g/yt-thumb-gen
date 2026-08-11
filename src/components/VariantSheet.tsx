import { useEffect, useRef, useState } from "react";
import { captureThumb } from "../lib/export";
import { sheetLayout } from "../lib/sheet";
import { loadConfig, type VariantMember } from "../lib/storage";
import { safeFileName } from "../lib/zip";
import { FORMATS, canvasSize, type ThumbDoc } from "../state";
import { labelOf } from "../lib/variants";
import { ThumbCanvas } from "./ThumbCanvas";
import { StickerCard } from "./ui/sticker-card";
import { StickerProgress } from "./ui/sticker-progress";

type Props = {
  /** The set to compose, base first. The open take's live document is passed separately so the
   *  sheet shows what is on screen rather than the last save. */
  members: VariantMember[];
  activeId: string | null;
  liveDoc: ThumbDoc;
  design: string;
  onDone: (message: string | null) => void;
  onError: (message: string) => void;
};

/**
 * Every take of a design in one labelled PNG.
 *
 * The comparison in the editor can't leave the editor, and "which of these three?" is a question
 * asked in a chat window — so this composes the set into a single image, lettered the same way
 * the compare grid letters it, and downloads it.
 *
 * It is `CampaignExporter`'s machinery with a different ending: each document is rendered
 * *offscreen* at scale 1 (parked far to the left rather than `display: none`, because a hidden
 * subtree has no layout and the effect backgrounds are WebGL that needs a real canvas), captured
 * with the same `captureThumb` the Export button uses, then drawn into one 2D context. Documents
 * are fetched one at a time because a hydrated one carries full-resolution images inline, and one
 * failed take is named in the summary instead of costing the others.
 */
export function VariantSheet({ members, activeId, liveDoc, design, onDone, onError }: Props) {
  const [progress, setProgress] = useState({ done: 0, total: members.length });
  const [current, setCurrent] = useState<ThumbDoc | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const paintedRef = useRef<() => void>(() => {});
  const cancelled = useRef(false);

  useEffect(() => {
    paintedRef.current();
  }, [current]);

  useEffect(() => {
    void run();
    return () => { cancelled.current = true; };
  }, []);

  /** Puts a document on the offscreen canvas and resolves once it has actually rendered. */
  const show = (doc: ThumbDoc) =>
    new Promise<void>((resolve) => {
      paintedRef.current = resolve;
      setCurrent(doc);
    });

  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

  async function run() {
    try {
      const shots: { member: VariantMember; image: HTMLImageElement }[] = [];
      const failed: string[] = [];

      for (const [i, m] of members.entries()) {
        if (cancelled.current) return;
        try {
          const doc = m.id === activeId ? liveDoc : (await loadConfig(m.id)).doc;
          await show(doc);
          // Two frames plus the font gate, for the same three reasons as the campaign export: the
          // first paints the layers, the second lets the effect canvases draw, and a webfont still
          // loading would be captured as a fallback.
          await nextFrame();
          await nextFrame();
          await document.fonts.ready;

          const node = nodeRef.current;
          if (!node) throw new Error("offscreen canvas is missing");
          // No `maxBytes`: a sheet is one image of several designs, so a platform's per-thumbnail
          // limit is not its limit, and a JPEG pass here would only soften what it is showing.
          const encoded = await captureThumb(node, {
            ...canvasSize(doc.format),
            platform: FORMATS[doc.format].platform,
            transparent: doc.background.mode === "transparent",
          });
          shots.push({ member: m, image: await loadImage(encoded.dataUrl) });
        } catch {
          failed.push(labelOf(m));
        }
        setProgress({ done: i + 1, total: members.length });
      }

      if (cancelled.current) return;
      if (shots.length === 0) {
        onError("Couldn't render any of the takes.");
        return;
      }

      // The sheet's shape comes from the first take's format — every member of a set shares it
      // unless an agent gave one its own, in which case that one is letterboxed into its cell.
      const first = canvasSize(shots[0].member.format ?? liveDoc.format);
      const plan = sheetLayout(shots.length, first.w / first.h);
      if (!plan) {
        onError("Couldn't lay out the sheet.");
        return;
      }

      const url = draw(plan, shots, design);
      const a = document.createElement("a");
      a.href = url;
      a.download = safeFileName(`${design} variants`, "png");
      a.click();

      onDone(
        failed.length
          ? `Sheet of ${shots.length} takes — ${failed.join(", ")} couldn't be rendered.`
          : `Sheet of ${shots.length} takes downloaded.`
      );
    } catch {
      onError("Couldn't build the sheet.");
    }
  }

  const size = current ? canvasSize(current.format) : { w: 0, h: 0 };

  return (
    <>
      <div className="fixed inset-0 z-50 grid place-items-center bg-[oklch(0_0_0/0.65)] p-4 backdrop-blur-sm">
        <StickerCard className="w-[min(360px,92vw)] gap-3 text-center">
          <p className="font-display text-sm font-bold">Building the comparison sheet</p>
          <StickerProgress
            value={progress.done}
            max={progress.total || 1}
            label={`Rendering ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`}
          />
        </StickerCard>
      </div>

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

/** A data URL as a decoded image, so it can be drawn into a 2D context. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to decode"));
    img.src = src;
  });
}

/** Composes the captured takes onto one canvas and returns it as a PNG data URL.
 *
 *  The furniture is deliberately plain — a dark ground, the design's name, a letter and a name per
 *  cell. The sheet's job is to be *read*, and anything decorative competes with the six designs it
 *  is showing. The picked take gets the one accent: nothing else on the sheet is lime. */
function draw(
  plan: NonNullable<ReturnType<typeof sheetLayout>>,
  shots: { member: VariantMember; image: HTMLImageElement }[],
  design: string
): string {
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0b0b0c";
  ctx.fillRect(0, 0, plan.width, plan.height);

  ctx.textBaseline = "top";
  ctx.fillStyle = "#f4f4f5";
  ctx.font = "700 28px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(design, plan.pad, plan.pad);
  ctx.fillStyle = "#8b8b90";
  ctx.font = "400 16px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(`${shots.length} takes · Thumb Studio`, plan.pad, plan.pad + 34);

  shots.forEach(({ member, image }, i) => {
    const cell = plan.cells[i];
    if (!cell) return;

    // Contained, not stretched: a take an agent gave a different format keeps its own shape.
    const scale = Math.min(cell.w / image.width, cell.h / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    const x = cell.x + (cell.w - w) / 2;
    const y = cell.y + (cell.h - h) / 2;

    ctx.fillStyle = "#17171a";
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    ctx.drawImage(image, x, y, w, h);

    const picked = !!member.wonAt;
    ctx.strokeStyle = picked ? "#c3f53c" : "#2a2a2e";
    ctx.lineWidth = picked ? 3 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const textY = cell.y + cell.h + 10;
    ctx.fillStyle = picked ? "#c3f53c" : "#f4f4f5";
    ctx.font = "700 20px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(labelOf(member) + (picked ? " ✓" : ""), cell.x, textY);
    ctx.fillStyle = "#8b8b90";
    ctx.font = "400 15px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(clip(ctx, member.name, cell.w - 52), cell.x + 42, textY + 2);
  });

  return canvas.toDataURL("image/png");
}

/** Truncates to fit a cell's width, so a long name can't run under its neighbour. */
function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > max) out = out.slice(0, -1);
  return `${out}…`;
}
