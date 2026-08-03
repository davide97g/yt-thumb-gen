import { useEffect, useState, type Dispatch, type RefObject } from "react";
import { AlertTriangle, Check, Info } from "lucide-react";
import type { Action, ThumbDoc } from "../state";
import type { Box } from "../lib/layout";
import { checkReadability, type Issue } from "../lib/readability";
import { GRID_W } from "../lib/safeAreas";
import { FORMATS } from "../state";
import { Section } from "./controls";
import { HoloBadge } from "./ui/holo-badge";
import { cn } from "@/lib/utils";

type Props = {
  doc: ThumbDoc;
  canvasRef: RefObject<HTMLDivElement | null>;
  dispatch: Dispatch<Action>;
};

/** The rules that need geometry need it measured: how wide a run of text renders is a fact
 *  only the DOM has. Same trick the canvas uses for snapping — `offsetWidth` on a node that
 *  is scaled by a CSS transform is still in canvas units. */
function measureBoxes(root: HTMLElement | null, doc: ThumbDoc): Record<string, Box> {
  if (!root) return {};
  const out: Record<string, Box> = {};
  for (const l of doc.layers) {
    const el = root.querySelector<HTMLElement>(`[data-layer-id="${l.id}"]`);
    if (el) out[l.id] = { x: l.x, y: l.y, w: el.offsetWidth, h: el.offsetHeight };
  }
  return out;
}

/** "Will this survive the feed?" — the checks in lib/readability, listed against the live
 *  design. Clicking a row selects the layer it's about, so a complaint is one click from
 *  the control that fixes it. */
export function ReadabilityPanel({ doc, canvasRef, dispatch }: Props) {
  const [issues, setIssues] = useState<Issue[]>([]);

  // Re-measure a frame after the doc settles: fonts, images and effects all change layout
  // after their own render, and measuring in the same tick reads the previous frame.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setIssues(checkReadability(doc, measureBoxes(canvasRef.current, doc))));
    return () => cancelAnimationFrame(raf);
  }, [doc, canvasRef]);

  const warnings = issues.filter((i) => i.severity === "warn").length;
  const gridW = GRID_W[doc.format];
  const gridH = Math.round((gridW * FORMATS[doc.format].h) / FORMATS[doc.format].w);

  return (
    <Section title="Readability" count={issues.length || undefined}>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Checked against how it's actually seen: {gridW}×{gridH} in the feed, with {FORMATS[doc.format].platform}'s own
        chrome on top.
      </p>

      {issues.length === 0 ? (
        // The one verdict in the rail worth a badge: a clean design is a state, not a row.
        <HoloBadge variant="primary" shape="tag" className="w-full justify-center gap-1.5 py-1.5 text-[11.5px]">
          <Check className="size-3.5 shrink-0" />
          Nothing flagged
        </HoloBadge>
      ) : (
        <ul className="space-y-1">
          {issues.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] leading-snug transition-colors",
                  i.layerId ? "hover:bg-accent/50" : "cursor-default",
                  i.severity === "warn" ? "text-foreground" : "text-muted-foreground"
                )}
                // A doc-level note (too many words) has no layer to jump to.
                onClick={() => i.layerId && dispatch({ type: "select", ids: [i.layerId] })}
              >
                {i.severity === "warn" ? (
                  <AlertTriangle className="mt-px size-3.5 shrink-0 text-primary" />
                ) : (
                  <Info className="mt-px size-3.5 shrink-0 text-muted-foreground/70" />
                )}
                <span className="min-w-0 flex-1">{i.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {warnings > 0 && (
        <p className="text-[10.5px] text-muted-foreground/70">
          These are rules of thumb, not gates — break them on purpose when the design earns it.
        </p>
      )}
    </Section>
  );
}
