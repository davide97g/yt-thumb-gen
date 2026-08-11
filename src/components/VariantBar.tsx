import { Columns2, Crown, Plus } from "lucide-react";
import type { VariantMember } from "../lib/storage";
import { labelOf } from "../lib/variants";
import { Hint } from "./controls";
import { DuckButtonGroup } from "./ui/duck-button-group";
import { HudChip } from "./ui/hud-chip";
import { HudLabel } from "./ui/hud-label";
import { QuackButton } from "./ui/quack-button";
import { StickerKbd } from "./ui/sticker-kbd";
import { StickerTooltip } from "./ui/sticker-tooltip";
import { cn } from "@/lib/utils";

type Props = {
  /** The set the open design belongs to, base first. Empty until the design has been saved —
   *  a variant is forked from a stored document, so there is nothing to fork before then. */
  members: VariantMember[];
  activeId: string | null;
  busy: boolean;
  comparing: boolean;
  onSwitch: (m: VariantMember) => void;
  onCreate: () => void;
  onCompare: () => void;
  onPromote: (m: VariantMember) => void;
};

/**
 * The variant set of the open design: one lettered chip per take, and the two things you do
 * with them — fork another, or put them side by side.
 *
 * It sits with the project card rather than in the archive, because a set is a property of the
 * design you have open, not a folder you browse. The letters are the whole point: they are what
 * the compare grid labels its cells with and what a decision gets recorded against, so a chip
 * here and a cell there always say the same word.
 *
 * Only the base can be published, which is why promoting exists at all: it swaps the documents
 * so the winner becomes what the design *is*, keeping its id, its name and its history.
 */
export function VariantBar({ members, activeId, busy, comparing, onSwitch, onCreate, onCompare, onPromote }: Props) {
  const active = members.find((m) => m.id === activeId) ?? null;
  const alternates = members.length - 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <HudLabel size="sm" tracking="tight" className="font-medium">
          Variants
        </HudLabel>
        <span className="flex items-center gap-0.5">
          {members.length > 1 && (
            <HudLabel size="sm" className="tabular-nums text-muted-foreground/70">
              {members.length}
            </HudLabel>
          )}
          {/* Works with nothing saved too: the fork needs a stored document, so `App` saves the
              canvas on the way through rather than making that the user's errand. */}
          <StickerTooltip content="Fork this design into another take" delay={400}>
            <QuackButton
              variant="ghost"
              size="icon-xs"
              ripple={false}
              onClick={onCreate}
              disabled={busy}
              aria-label="New variant"
              className="size-6 text-muted-foreground/70"
            >
              <Plus className="size-3.5" />
            </QuackButton>
          </StickerTooltip>
        </span>
      </div>

      {members.length === 0 ? (
        // Nothing to show and one thing to say. A row of dead chips would imply the feature is
        // broken rather than not started.
        <Hint>Fork this design into A/B takes, then compare them side by side.</Hint>
      ) : (
        <>
          {/* One chip per take. `HudChip active` is the same vocabulary the stage lenses and the
              draw tool use, so "this one is on" reads the same everywhere in the editor.
              Labelled by `title` rather than a StickerTooltip, like the header's undo/redo
              cluster: a joined group styles its direct children, and the shield span a tooltip
              puts around a disabled control would take that styling instead of the chip. */}
          <DuckButtonGroup aria-label="Variants" className="flex-wrap">
            {members.map((m) => {
              const isActive = m.id === activeId;
              return (
                <HudChip
                  key={m.id}
                  size="xs"
                  active={isActive}
                  disabled={busy}
                  title={`${m.name}${m.wonAt ? " — picked" : ""}`}
                  className="min-w-8 justify-center gap-1 px-2 font-mono"
                  aria-pressed={isActive}
                  onClick={() => { if (!isActive) onSwitch(m); }}
                >
                  {labelOf(m)}
                  {m.wonAt && <Crown className="size-3 text-primary" aria-label="Picked" />}
                </HudChip>
              );
            })}
          </DuckButtonGroup>

          <QuackButton
            variant={comparing ? "primary" : "outline"}
            size="sm"
            className="h-7 w-full px-2 text-xs"
            disabled={alternates < 1}
            onClick={onCompare}
          >
            <Columns2 />
            <span className="truncate">{comparing ? "Back to editing" : "Compare"}</span>
            {/* A real keycap that depresses on the actual keystroke, like the Deselect chip's. */}
            <StickerKbd watch="v" className="ml-auto min-w-4 px-1 py-0 text-[10px]">V</StickerKbd>
          </QuackButton>

          {/* Offered only where it means something: on a variant. On the base it would be a
              button that says the design should become itself. */}
          {active && !active.isBase && (
            <QuackButton
              variant="ghost"
              size="sm"
              ripple={false}
              disabled={busy}
              onClick={() => onPromote(active)}
              className={cn("h-7 w-full justify-start px-1.5 text-xs text-primary")}
            >
              <Crown /> Make {labelOf(active)} the design
            </QuackButton>
          )}
        </>
      )}
    </div>
  );
}
