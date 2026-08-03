import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

/**
 * HudCode — a monospace token inside a sentence, tinted with --primary so it
 * reads as verifiable data: a wikilink, a timecode, a record id, a citation.
 *
 * Nothing else in the registry is this. DuckProse styles inline code as a
 * neutral --muted chip, which is right for a snippet of source and wrong for a
 * citation, because a citation is the most important word in the sentence.
 * HoloBadge is a pill for status and sits outside the text flow. HudLabel is a
 * block label with 0.3em of tracking, which is unreadable mid-paragraph. The
 * gap was filled in application code often enough that it is the single
 * most-used atom in at least one app built on this registry.
 *
 * The chip must not move the line it sits in, which drives most of the CSS.
 * Padding and border on an inline box never enter the line box, so those are
 * free; the font size is 0.875em and the leading is collapsed, which keeps the
 * chip's own box well under the paragraph's strut. That is also why the hover
 * "lift" is optical — more fill, a brighter border — rather than a translate:
 * transform does not apply to inline boxes, and switching to inline-block to
 * allow one would let the padding into the line box and change the leading of
 * the paragraph on hover.
 *
 * The colours are `bg-primary/10` and `border-primary/25`, which Tailwind emits
 * as color-mix(in oklab, var(--primary) …%, transparent) — the same expression
 * a hand-written override reaches for, but through the token, so a theme that
 * moves --primary moves the citations with it.
 *
 * `interactive` makes it a real button and `asChild` takes whatever the caller
 * passes, usually a link. Neither keeps the <code> element: a nested <code>
 * inside the control would be styled by DuckProse's own `code` rule and need
 * three utilities to undo, and "button, tape at 12:04" is a more useful
 * announcement than a wrapper most screen readers do not mention. When the
 * token really is source rather than a reference, leave it non-interactive.
 *
 * Why one plain class is enough to beat DuckProse: every rule in that component
 * is wrapped in :where() and therefore has zero specificity, so a single class
 * selector on the element outranks all of it with no !important anywhere. The
 * prose surface was built to be restyled from outside, and this is the recipe.
 */

const hudCodeClasses = [
  "font-mono text-[0.875em] leading-none whitespace-nowrap align-baseline",
  "rounded-sm border border-primary/25 bg-primary/10 px-[0.4em] py-[0.08em]",
  // no-underline: inside DuckProse an asChild anchor would otherwise inherit
  // the prose link underline, and a chip with a rule through it reads as struck
  // out rather than as a link.
  "text-primary no-underline",
];

const hudCodeInteractiveClasses = [
  "cursor-pointer transition-[background-color,border-color,color] duration-200 ease-[var(--ease-duck)]",
  "hover:border-primary/55 hover:bg-primary/20",
  // A tight ring offset: two pixels of background around an inline chip cuts a
  // visible notch in the line above it.
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
];

/**
 * Props are the button's, minus `type`, which this component owns. The rendered
 * element is a <code> most of the time, but a <code> accepts a subset of what a
 * button does: typing it the other way round narrows `ref` and `onClick` to
 * HTMLElement, and TypeScript then refuses to hand either to a button — which
 * is the form that actually uses them. `disabled` only applies there too.
 */
export interface HudCodeProps
  extends Omit<React.ComponentProps<"button">, "type"> {
  /**
   * Render a button instead of a <code>, for the click-a-citation case. Ignored
   * when asChild is set — the child is already the control.
   */
  interactive?: boolean;
  /** Render the child element: an anchor, a next/link Link. */
  asChild?: boolean;
}

function HudCode({
  className,
  interactive = false,
  asChild = false,
  disabled,
  ...props
}: HudCodeProps) {
  if (!asChild && !interactive) {
    return (
      <code
        data-slot="hud-code"
        className={cn(hudCodeClasses, className)}
        {...props}
      />
    );
  }

  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      type={asChild ? undefined : "button"}
      disabled={asChild ? undefined : disabled}
      aria-disabled={asChild && disabled ? true : undefined}
      data-slot="hud-code"
      data-interactive=""
      className={cn(hudCodeClasses, hudCodeInteractiveClasses, className)}
      {...props}
    />
  );
}

export { HudCode };
