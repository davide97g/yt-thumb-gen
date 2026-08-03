"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

/**
 * StickerTooltip — the last overlay primitive, and the one with a warning
 * attached.
 *
 * A tooltip is hover-only chrome: it does not exist on touch, and it is gone
 * the moment the pointer leaves. So it is for a label that has nowhere else to
 * live — an icon-only control, a truncated value, a timestamp in full — and
 * never for information the user needs to complete the task. If the content
 * matters, it belongs on the page. If it is a keyboard shortcut, StickerKbd
 * prints it inline where every user can see it.
 *
 * Radix underneath, so a keyboard user does get it: the trigger opens on focus
 * as well as hover, Escape dismisses, and the content is wired to the trigger
 * with aria-describedby rather than left as a floating div.
 *
 * duck adds the die-cut edge, the arrow cut from the same vinyl, and an arrival
 * short enough not to feel like a decision — 120ms, no bounce.
 *
 * The one case Radix cannot handle on its own is the disabled control. A
 * disabled <button> receives no pointer events and takes no focus, so the label
 * vanishes exactly when it is most wanted — "why can't I press Save?" is the
 * question a tooltip exists to answer. The fix is a focusable wrapper around the
 * dead control, and StickerTooltip applies it itself: pass a child that is
 * disabled or aria-disabled and the trigger becomes a `tabIndex={0}` span with
 * the control inside it. Set `wrapDisabled={false}` to opt out.
 */

const StickerTooltipProvider = TooltipPrimitive.Provider;
const StickerTooltipRoot = TooltipPrimitive.Root;
const StickerTooltipTrigger = TooltipPrimitive.Trigger;

function StickerTooltipContent({
  className,
  sideOffset = 8,
  arrow = true,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  /** Draw the pointer. Turn it off for a tooltip that is really a caption. */
  arrow?: boolean;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="sticker-tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-xs rounded-lg bg-popover px-3 py-1.5 text-xs text-popover-foreground",
          "sticker border-border duck-glow",
          // Radix keeps the node mounted through the exit, so both directions
          // are real. The tooltip rises from whichever side it opened on.
          "data-[state=delayed-open]:[animation:duck-rise_0.12s_var(--ease-duck)]",
          "data-[state=instant-open]:[animation:duck-rise_0.12s_var(--ease-duck)]",
          "data-[state=closed]:[animation:duck-fade-out_0.1s_var(--ease-duck)]",
          className
        )}
        {...props}
      >
        {children}
        {arrow && (
          <TooltipPrimitive.Arrow
            data-slot="sticker-tooltip-arrow"
            width={12}
            height={6}
            // The arrow is a filled triangle, not a rotated square, so the
            // sticker border cannot follow it around the corner. Matching the
            // border colour reads as the same edge; matching the fill does not.
            className="fill-border"
          />
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export interface StickerTooltipProps
  extends React.ComponentProps<typeof TooltipPrimitive.Root> {
  /** The label. Keep it to a few words. */
  content: React.ReactNode;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"];
  arrow?: boolean;
  /** Milliseconds of hover before it opens. */
  delay?: number;
  /**
   * Wrap a disabled child in a focusable span so the label still opens. On by
   * default; turn it off when the extra element breaks a layout and the control
   * is disabled for a reason the page already states.
   */
  wrapDisabled?: boolean;
  /** The control being labelled. Rendered as the trigger itself. */
  children: React.ReactNode;
}

/**
 * A disabled control is inert to the pointer and out of the tab order, so the
 * trigger has to be something else. `aria-disabled` counts too: that is the
 * form a Slot-rendered anchor takes, and it is just as unhoverable in practice
 * because the component pairs it with pointer-events-none.
 */
function isInert(child: React.ReactNode) {
  if (!React.isValidElement<{ disabled?: boolean; "aria-disabled"?: unknown }>(child)) {
    return false;
  }
  const { disabled, "aria-disabled": ariaDisabled } = child.props;
  return Boolean(disabled) || ariaDisabled === true || ariaDisabled === "true";
}

/**
 * The whole thing in one element, for the common case: a trigger, a label, and
 * its own provider so a single tooltip on a page needs no setup. Compose the
 * parts instead when a group of controls should share one delay.
 */
function StickerTooltip({
  content,
  side = "top",
  align = "center",
  arrow = true,
  delay = 250,
  wrapDisabled = true,
  children,
  ...props
}: StickerTooltipProps) {
  const trigger =
    wrapDisabled && isInert(children) ? (
      // inline-flex so the wrapper takes the control's own box rather than a
      // line box, and the cursor still reads as refused over the gap.
      <span data-slot="sticker-tooltip-shield" tabIndex={0} className="inline-flex cursor-not-allowed">
        {children}
      </span>
    ) : (
      children
    );

  return (
    <StickerTooltipProvider delayDuration={delay}>
      <StickerTooltipRoot {...props}>
        <StickerTooltipTrigger asChild>{trigger}</StickerTooltipTrigger>
        <StickerTooltipContent side={side} align={align} arrow={arrow}>
          {content}
        </StickerTooltipContent>
      </StickerTooltipRoot>
    </StickerTooltipProvider>
  );
}

export {
  StickerTooltip,
  StickerTooltipProvider,
  StickerTooltipRoot,
  StickerTooltipTrigger,
  StickerTooltipContent,
};
