"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

/**
 * StickerPopover — the panel that opens next to the thing it belongs to.
 *
 * duck's standing advice is that anything it does not ship should be plain
 * shadcn, because the theme already styles it. That holds for colour, radius
 * and type. It does not hold for the edge: a stock popover carries a 1px
 * border and a drop shadow, so opening one two pixels from a StickerCard shows
 * two different materials on the same screen. Menus and panels are the most
 * common surface in an application after the card, which makes that the most
 * visible seam in the system — hence a component.
 *
 * Radix Popover underneath, so the parts that are easy to get wrong are not
 * ours: focus moves into the panel on open and back to the trigger on close,
 * Escape and an outside click dismiss, and the trigger carries aria-expanded
 * and aria-controls rather than being a div that toggles state.
 *
 * A popover is not a menu. It has no roving focus, no typeahead and no
 * `menuitem` roles, so a list of commands inside it is reached with Tab, one
 * stop per control. For a set of exclusive choices use StickerToggleGroup; for
 * a real menu use shadcn's DropdownMenu and paste STICKER_SURFACE onto its
 * content so the edge still matches.
 */

/**
 * The die-cut surface as one class string: 3px edge, popover fill, glow, and
 * the radius that sits between the tooltip chip and the dialog panel.
 *
 * It is exported because the recipe is the point. Stock shadcn overlays —
 * `DropdownMenuContent`, `SelectContent`, `PopoverContent` — need this to stop
 * looking like a different material, and a recipe printed only in the docs
 * drifts from the component the first time either changes. This is what
 * StickerPopoverContent itself wears, so it cannot.
 *
 * Appended after a stock class list it wins on every property it touches:
 * `rounded-xl` and `border-border` beat their equivalents through
 * tailwind-merge, and `sticker` and `duck-glow` land later in the utilities
 * layer than `border` and `shadow-md`. Geometry is deliberately absent —
 * padding and width belong to whatever is being restyled.
 */
const STICKER_SURFACE =
  "rounded-xl bg-popover text-popover-foreground sticker border-border duck-glow";

const StickerPopoverRoot = PopoverPrimitive.Root;
const StickerPopoverTrigger = PopoverPrimitive.Trigger;
const StickerPopoverClose = PopoverPrimitive.Close;
/** Position against something other than the trigger — a table cell, a word. */
const StickerPopoverAnchor = PopoverPrimitive.Anchor;

export interface StickerPopoverContentProps
  extends React.ComponentProps<typeof PopoverPrimitive.Content> {
  /** Draw the pointer back at the trigger. */
  arrow?: boolean;
  /** Iridescent ring instead of the solid die-cut edge. */
  holo?: boolean;
}

function StickerPopoverContent({
  className,
  side = "bottom",
  align = "center",
  sideOffset = 10,
  arrow = true,
  holo = false,
  children,
  ...props
}: StickerPopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="sticker-popover-content"
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 p-4 outline-none",
          // holo-border fills its padding box with --card, so the holo panel is
          // card-coloured rather than popover-coloured. In dark the two are a
          // hair apart and holo is defined against the card everywhere else.
          holo
            ? "rounded-xl bg-card text-card-foreground holo-border duck-glow"
            : STICKER_SURFACE,
          // Radix keeps the node mounted through the exit, so both directions
          // are real. The panel rises into place on the vertical sides, the
          // same 14px as every other duck overlay; on the horizontal ones it
          // only fades, because vertical movement beside a trigger reads as
          // belonging to something else on the page.
          //
          // Each one is a keyframe whose last frame is the resting state, never
          // a transform utility waiting to be transitioned away. Reduced motion
          // cuts animation-duration to nothing, so the panel is simply there
          // rather than parked 14px low with its opacity stuck.
          "data-[state=open]:data-[side=top]:[animation:duck-rise_0.16s_var(--ease-duck)]",
          "data-[state=open]:data-[side=bottom]:[animation:duck-rise_0.16s_var(--ease-duck)]",
          "data-[state=open]:data-[side=left]:[animation:duck-fade-in_0.16s_var(--ease-duck)]",
          "data-[state=open]:data-[side=right]:[animation:duck-fade-in_0.16s_var(--ease-duck)]",
          "data-[state=closed]:[animation:duck-fade-out_0.12s_var(--ease-duck)]",
          className
        )}
        {...props}
      >
        {children}
        {arrow && (
          <PopoverPrimitive.Arrow
            data-slot="sticker-popover-arrow"
            width={14}
            height={7}
            // A filled triangle, so the 3px edge cannot be carried round it.
            // Matching the border colour reads as the same cut; matching the
            // fill reads as a hole. Holo keeps it too — a gradient ring has no
            // triangle to lend.
            className="fill-border"
          />
        )}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export interface StickerPopoverProps
  extends React.ComponentProps<typeof PopoverPrimitive.Root> {
  /** The panel. Anything that would not fit in a tooltip and does not warrant a dialog. */
  content: React.ReactNode;
  side?: StickerPopoverContentProps["side"];
  align?: StickerPopoverContentProps["align"];
  sideOffset?: number;
  arrow?: boolean;
  holo?: boolean;
  /** Sizing goes here. The panel is w-72 and p-4 until told otherwise. */
  contentClassName?: string;
  /** The control that opens it. Rendered as the trigger itself. */
  children: React.ReactNode;
}

/**
 * The whole thing in one element, for the common case: a trigger and a panel.
 * Compose the parts when the panel needs a close button of its own, an anchor
 * that is not the trigger, or a controlled `open`.
 */
function StickerPopover({
  content,
  side = "bottom",
  align = "center",
  sideOffset = 10,
  arrow = true,
  holo = false,
  contentClassName,
  children,
  ...props
}: StickerPopoverProps) {
  return (
    <StickerPopoverRoot {...props}>
      <StickerPopoverTrigger asChild>{children}</StickerPopoverTrigger>
      <StickerPopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        arrow={arrow}
        holo={holo}
        className={contentClassName}
      >
        {content}
      </StickerPopoverContent>
    </StickerPopoverRoot>
  );
}

export {
  StickerPopover,
  StickerPopoverRoot,
  StickerPopoverTrigger,
  StickerPopoverContent,
  StickerPopoverClose,
  StickerPopoverAnchor,
  STICKER_SURFACE,
};
