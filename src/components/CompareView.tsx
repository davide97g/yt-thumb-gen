import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Crown, Download, Pencil, X } from "lucide-react";
import { FORMATS, canvasSize, type ThumbDoc } from "../state";
import type { Box } from "../lib/layout";
import { checkReadability } from "../lib/readability";
import { GRID_W } from "../lib/safeAreas";
import { loadConfig, type VariantMember } from "../lib/storage";
import { CELL_GAP, CELL_LABEL_H, LIVE_CELLS, labelOf, planGrid, visible } from "../lib/variants";
import { ThumbCanvas } from "./ThumbCanvas";
import { DuckSpinner } from "./ui/duck-spinner";
import { GlowInput } from "./ui/glow-input";
import { HudChip } from "./ui/hud-chip";
import { HudLabel } from "./ui/hud-label";
import { QuackButton } from "./ui/quack-button";
import { StickerToggleGroup, StickerToggleGroupItem } from "./ui/sticker-toggle-group";
import { StickerTooltip } from "./ui/sticker-tooltip";
import { cn } from "@/lib/utils";

type Props = {
  members: VariantMember[];
  /** The take currently open in the editor. Its cell shows the live document. */
  activeId: string | null;
  /** The editor's document, unsaved edits included — see `docFor`. */
  liveDoc: ThumbDoc;
  busy: boolean;
  onOpen: (m: VariantMember) => void;
  onPromote: (m: VariantMember) => void;
  onNote: (m: VariantMember, note: string) => void;
  /** Composes every take into one labelled PNG — the only way this comparison leaves the editor. */
  onSheet: () => void;
  onClose: () => void;
  onError: (msg: string) => void;
};

type Mode = "grid" | "feed";

/**
 * The design's takes, side by side.
 *
 * Two layouts, and the second one is the reason this exists. **Grid** is the set as large as the
 * stage will draw it — the view for judging craft. **Feed** is every take at `GRID_W`, the width
 * of the surface the format is really browsed at, laid out as platform cards with the design's
 * own name as the title: the honest test, and the one that changes minds, because a title that
 * reads beautifully at 512px is often a grey smear at 210px.
 *
 * Three things it is careful about:
 *
 * • **The open take shows the live document.** Comparing what you just edited against a stale
 *   copy of it is worse than not comparing at all, so the active cell reads the editor's doc
 *   directly and only the others are fetched.
 * • **Every cell is a real `ThumbCanvas`** — one renderer, same as the export and the headless
 *   render — which means each design with an effect background holds a WebGL context and each
 *   hydrated document carries its images inline. Hence `LIVE_CELLS`, and hence the footer
 *   *saying* what it left out: a comparison missing two candidates has to admit it.
 * • **The verdicts are the real ones.** `checkReadability` needs geometry only the DOM has, so
 *   each cell is measured after it paints, exactly as `ReadabilityPanel` measures the canvas.
 */
export function CompareView({ members, activeId, liveDoc, busy, onOpen, onPromote, onNote, onSheet, onClose, onError }: Props) {
  const [mode, setMode] = useState<Mode>("grid");
  // Fetched documents, by project id. A ref-like cache in state because rendering depends on it;
  // dropped whole when the set changes, so a promoted design can't be drawn from a stale copy.
  const [docs, setDocs] = useState<Record<string, ThumbDoc>>({});
  const [warnings, setWarnings] = useState<Record<string, number>>({});
  const [stage, setStage] = useState<Box2>({ w: 0, h: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());

  const { shown, hidden } = useMemo(() => visible(members, activeId), [members, activeId]);
  const ids = shown.map((m) => m.id).join(",");
  // The cache key carries the row's timestamp, not just its id. A promotion swaps the documents
  // behind two ids, so a cache keyed on id alone would paint the wrong design under the right
  // letter — this way a changed row simply misses, and no invalidation pass has to be remembered.
  const keys = useMemo(() => new Map(members.map((m) => [m.id, `${m.id}:${m.updatedAt}`])), [members]);
  const stamps = [...keys.values()].join(",");

  /** The document for a member: the editor's own for the open take, a fetched copy otherwise. */
  const docFor = (m: VariantMember): ThumbDoc | null =>
    m.id === activeId ? liveDoc : (docs[keys.get(m.id) ?? m.id] ?? null);

  // Fetched one at a time, not in parallel: a hydrated document holds full-resolution images as
  // data URLs, and four of them arriving together is four photos in flight for a screen that
  // shows them at 300px.
  useEffect(() => {
    let live = true;
    (async () => {
      for (const m of shown) {
        const key = keys.get(m.id) ?? m.id;
        if (!live) return;
        if (m.id === activeId || docs[key]) continue;
        try {
          const full = await loadConfig(m.id);
          if (!live) return;
          // Pruned to the keys still in play as it writes, so a long session of edits can't
          // accumulate documents nothing will draw again.
          setDocs((prev) => {
            const live = new Set(keys.values());
            const next: Record<string, ThumbDoc> = { [key]: full.doc };
            for (const [k, v] of Object.entries(prev)) if (live.has(k)) next[k] = v;
            return next;
          });
        } catch {
          onError(`Couldn't load ${labelOf(m)}.`);
        }
      }
    })();
    return () => { live = false; };
  }, [ids, stamps, activeId]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // The verdict per cell, measured a frame after the documents settle — fonts, images and effect
  // canvases all change layout after their own render, so measuring in the same tick reads the
  // previous frame. Same rule, same reason as `ReadabilityPanel`.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const next: Record<string, number> = {};
      for (const m of shown) {
        const doc = docFor(m);
        const root = cellRefs.current.get(m.id);
        if (!doc) continue;
        const boxes: Record<string, Box> = {};
        for (const l of doc.layers) {
          const node = root?.querySelector<HTMLElement>(`[data-layer-id="${l.id}"]`);
          if (node) boxes[l.id] = { x: l.x, y: l.y, w: node.offsetWidth, h: node.offsetHeight };
        }
        next[m.id] = checkReadability(doc, boxes).filter((i) => i.severity === "warn").length;
      }
      setWarnings(next);
    });
    return () => cancelAnimationFrame(raf);
  }, [ids, docs, liveDoc, mode]);

  // Every take in a set shares the base's format in practice, but a variant given its own
  // document by an agent need not — so the grid is planned on the open design's shape and each
  // cell scales its own canvas to fit inside the cell it was given.
  const planFormat = FORMATS[liveDoc.format];
  const plan = mode === "grid" ? planGrid(shown.length, { w: stage.w, h: stage.h }, { w: planFormat.w, h: planFormat.h }) : null;
  const won = members.find((m) => m.wonAt) ?? null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col gap-3 bg-background/92 p-3 backdrop-blur-sm md:p-5">
      {/* Head: what this is, which layout, and the way out. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <HudLabel size="sm" tracking="tight" className="font-medium">
            Compare
          </HudLabel>
          <HudLabel size="sm" className="truncate text-muted-foreground/70">
            {shown.length} of {members.length} takes
            {mode === "feed" && ` · ${GRID_W[liveDoc.format]}px, the size it's browsed at`}
          </HudLabel>
        </div>
        <div className="flex items-center gap-2">
          <StickerToggleGroup type="single" size="sm" value={mode} onValueChange={(v) => { if (v) setMode(v as Mode); }}>
            <StickerToggleGroupItem value="grid">Large</StickerToggleGroupItem>
            <StickerToggleGroupItem value="feed">In feed</StickerToggleGroupItem>
          </StickerToggleGroup>
          {/* Every take — not just the four on screen — because the sheet is for asking someone
              else, and the ceiling here is WebGL contexts, which a one-at-a-time render doesn't hit. */}
          <StickerTooltip content={`Download all ${members.length} takes as one labelled PNG`} delay={400}>
            <QuackButton variant="outline" size="sm" className="h-8 px-2.5 text-xs" disabled={busy} onClick={onSheet}>
              <Download />
              <span className="hidden sm:inline">Sheet</span>
            </QuackButton>
          </StickerTooltip>
          <StickerTooltip content="Back to editing (V)" delay={400}>
            <QuackButton variant="ghost" size="icon-sm" ripple={false} onClick={onClose} aria-label="Close compare">
              <X />
            </QuackButton>
          </StickerTooltip>
        </div>
      </div>

      {/* The cells. `min-h-0` so the measured box is the leftover height and not the content's. */}
      <div ref={boxRef} className={cn("min-h-0 flex-1", mode === "feed" && "overflow-auto")}>
        {mode === "grid" ? (
          plan ? (
            <div
              className="grid h-full w-full place-content-center"
              style={{ gridTemplateColumns: `repeat(${plan.cols}, ${plan.cell.w}px)`, gap: CELL_GAP, justifyContent: "center" }}
            >
              {shown.map((m) => (
                <Cell
                  key={m.id}
                  member={m}
                  doc={docFor(m)}
                  fit={plan.cell}
                  active={m.id === activeId}
                  warnings={warnings[m.id]}
                  busy={busy}
                  onOpen={onOpen}
                  onPromote={onPromote}
                  register={(el) => registerCell(cellRefs, m.id, el)}
                />
              ))}
            </div>
          ) : (
            // Not an error: the stage is genuinely too small to show this many frames at a size
            // anything could be judged at. Saying so beats drawing postage stamps.
            <div className="grid h-full place-items-center text-center">
              <p className="max-w-xs text-xs text-muted-foreground">
                Not enough room to show {shown.length} takes at a useful size. Hide the panels (\) or switch to “In feed”.
              </p>
            </div>
          )
        ) : (
          <div className="flex flex-wrap items-start justify-center gap-4">
            {shown.map((m) => (
              <FeedCard
                key={m.id}
                member={m}
                doc={docFor(m)}
                active={m.id === activeId}
                warnings={warnings[m.id]}
                busy={busy}
                onOpen={onOpen}
                onPromote={onPromote}
                register={(el) => registerCell(cellRefs, m.id, el)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Foot: what was left out, and the decision. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        {hidden.length > 0 ? (
          <HudLabel size="sm" className="text-muted-foreground/70">
            {hidden.map(labelOf).join(", ")} not shown — {LIVE_CELLS} at a time
          </HudLabel>
        ) : (
          <span />
        )}
        {/* The recorded reason. Only offered once something has been picked: a note about a
            decision nobody has made is a field nobody can fill in. */}
        {won && (
          <label className="flex min-w-0 flex-1 items-center gap-2 md:max-w-md">
            <HudLabel size="sm" className="shrink-0 text-muted-foreground/70">
              Picked {labelOf(won)}
            </HudLabel>
            <GlowInput
              frame={false}
              defaultValue={won.note ?? ""}
              key={`${won.id}:${won.note ?? ""}`}
              placeholder="Why this one?"
              aria-label={`Why ${labelOf(won)} was picked`}
              className="h-7 min-w-0 flex-1 bg-secondary/40 px-2 text-xs"
              onBlur={(e) => { if (e.target.value !== (won.note ?? "")) onNote(won, e.target.value); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

type Box2 = { w: number; h: number };

/** Keeps the per-cell measurement roots in one map, dropping the entry when the cell unmounts —
 *  a stale node would be measured for a take that is no longer on screen. */
function registerCell(refs: { current: Map<string, HTMLDivElement> }, id: string, el: HTMLDivElement | null) {
  if (el) refs.current.set(id, el);
  else refs.current.delete(id);
}

type CellProps = {
  member: VariantMember;
  doc: ThumbDoc | null;
  active: boolean;
  warnings: number | undefined;
  busy: boolean;
  onOpen: (m: VariantMember) => void;
  onPromote: (m: VariantMember) => void;
  register: (el: HTMLDivElement | null) => void;
};

/** One take at whatever size it was given. `exporting` keeps the selection chrome and the review
 *  overlays out — a cell is a picture of the design, not a place to edit it — and the wrapper is
 *  pointer-inert so a stray drag can't move a layer in a document that isn't open. */
function Frame({
  doc, fit, register, ring,
}: { doc: ThumbDoc | null; fit: Box2; register: (el: HTMLDivElement | null) => void; ring: string }) {
  const size = doc ? canvasSize(doc.format) : { w: 16, h: 9 };
  // Contain, not fill: a take an agent gave a different format keeps its own shape rather than
  // being stretched into the base's.
  const scale = Math.min(fit.w / size.w, fit.h / size.h);
  const inner = useRef<HTMLDivElement>(null);

  return (
    <div
      className={cn("grid place-items-center overflow-hidden rounded-[4px] bg-black/40 ring-1", ring)}
      style={{ width: fit.w, height: fit.h }}
    >
      {doc ? (
        <div ref={register} className="pointer-events-none" style={{ width: size.w * scale, height: size.h * scale }}>
          <ThumbCanvas
            doc={doc}
            scale={scale}
            selectedIds={[]}
            exporting
            cropMode={null}
            setCropMode={() => {}}
            drawMode={false}
            setDrawMode={() => {}}
            canvasRef={inner}
            dispatch={() => {}}
          />
        </div>
      ) : (
        <DuckSpinner size="sm" label="Loading variant" />
      )}
    </div>
  );
}

/** A cell's label row: the letter, the verdict, and the two actions. */
function CellLabel({
  member, active, warnings, busy, onOpen, onPromote, width,
}: Omit<CellProps, "doc" | "register"> & { width?: number }) {
  return (
    <div className="flex items-center gap-1.5" style={width ? { width } : undefined}>
      <HudLabel size="sm" className={cn("shrink-0 font-mono", active ? "text-primary" : "text-muted-foreground")}>
        {labelOf(member)}
      </HudLabel>
      {member.wonAt && <Crown className="size-3 shrink-0 text-primary" aria-label="Picked" />}
      {/* The verdict, in the one number that matters here: how many things this take gets wrong
          at the size it will be seen. Zero is worth saying too — it is the answer you want. */}
      {warnings !== undefined && (
        <HudChip
          size="xs"
          frame={false}
          className={cn("h-5 shrink-0 px-1 tabular-nums", warnings > 0 ? "text-primary" : "text-muted-foreground/60")}
          title={warnings > 0 ? `${warnings} readability warning${warnings === 1 ? "" : "s"}` : "Nothing flagged"}
        >
          {warnings > 0 ? `${warnings}⚠` : "✓"}
        </HudChip>
      )}
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80" title={member.name}>
        {member.name}
      </span>
      {!active && (
        <StickerTooltip content="Edit this take" delay={400} wrapDisabled>
          <QuackButton
            variant="ghost"
            size="icon-xs"
            ripple={false}
            disabled={busy}
            className="size-5 shrink-0 text-muted-foreground/70"
            aria-label={`Edit ${labelOf(member)}`}
            onClick={() => onOpen(member)}
          >
            <Pencil className="size-3" />
          </QuackButton>
        </StickerTooltip>
      )}
      {!member.isBase && (
        <StickerTooltip content={`Make ${labelOf(member)} the design`} delay={400} wrapDisabled>
          <QuackButton
            variant="ghost"
            size="icon-xs"
            ripple={false}
            disabled={busy}
            className="size-5 shrink-0 text-primary"
            aria-label={`Make ${labelOf(member)} the design`}
            onClick={() => onPromote(member)}
          >
            <Crown className="size-3" />
          </QuackButton>
        </StickerTooltip>
      )}
    </div>
  );
}

/** Grid layout: one take as large as the plan allows, its label under it. */
function Cell({ member, doc, fit, active, warnings, busy, onOpen, onPromote, register }: CellProps & { fit: Box2 }) {
  return (
    <div className="flex flex-col gap-1" style={{ width: fit.w }}>
      <Frame doc={doc} fit={fit} register={register} ring={active ? "ring-primary/50" : "ring-border/70"} />
      <div style={{ height: CELL_LABEL_H - 4 }}>
        <CellLabel member={member} active={active} warnings={warnings} busy={busy} onOpen={onOpen} onPromote={onPromote} />
      </div>
    </div>
  );
}

/** Feed layout: the take at the width of a real grid cell, dressed as the card it will be. The
 *  title line is the design's own name, because the thing being tested is whether the picture
 *  still works next to it — an empty grey bar tests nothing. */
function FeedCard({ member, doc, active, warnings, busy, onOpen, onPromote, register }: CellProps) {
  const format = doc?.format ?? "youtube";
  const w = GRID_W[format];
  const size = canvasSize(format);
  const fit = { w, h: (w * size.h) / size.w };

  return (
    <div className="flex flex-col gap-1.5" style={{ width: Math.max(w, 150) }}>
      <Frame doc={doc} fit={fit} register={register} ring={active ? "ring-primary/50" : "ring-border/60"} />
      {/* The platform's own furniture around the picture, at the same scale: two lines of title,
          a channel line. Deliberately plain — it is a ruler, not a mock of the client. */}
      <div className="space-y-1">
        <p className="line-clamp-2 text-[12px] font-medium leading-tight text-foreground/90">{member.name}</p>
        <p className="text-[11px] leading-none text-muted-foreground/60">
          {FORMATS[format].platform} · {w}px
        </p>
      </div>
      <CellLabel member={member} active={active} warnings={warnings} busy={busy} onOpen={onOpen} onPromote={onPromote} />
    </div>
  );
}
