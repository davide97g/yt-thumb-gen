import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * HudChip — the interactive HUD label. Nav items, row actions, a zoom cluster,
 * retry, esc, the thing that opens the share menu: the most repeated control in
 * an application's chrome, and the one the registry did not have.
 *
 * It exists because the two components either side of it are each nearly right.
 * HudLabel has the instrument typography — mono, uppercase, tracked wide — and
 * no interaction at all. QuackButton has the interaction and takes its
 * typography from --font-button / --tracking-button / --case-button, which is
 * the sans CTA vocabulary: correct for "Get started", wrong for "zoom out".
 * So every application converges on the same local primitive, a
 * `QuackButton variant="outline" size="sm"` wearing `.hud` plus five classes to
 * undo the button's own padding and colour — copy-pasted, in one real case,
 * under four different names. This is that shape, written once. It is not a
 * QuackButton wrapper: inheriting the motion cycle, the ripple and the magnet
 * to then suppress them is more code than the chip is.
 *
 * Typography comes from the `.hud` utility that the hud-label item ships rather
 * than from classes here, so a chip and a HudLabel sitting in the same row
 * cannot drift apart — the drift was the original complaint.
 *
 * `active` is visual, and deliberately does not pick an ARIA attribute. The
 * same highlight means aria-current="page" on a nav link, aria-pressed on a
 * filter toggle and aria-selected inside a tablist; a component that guessed
 * would be wrong two times in three. It paints the state and emits
 * data-active — the call site owns the semantics, and without one of those
 * attributes the highlight is invisible to a screen reader.
 *
 * Icons are children rather than an `icon` prop. A prop needs a second prop the
 * first time somebody wants a trailing chevron, and lucide children already
 * size themselves here the way they do in every other duck control.
 */

const hudChipVariants = cva(
  [
    // .hud carries family, size, weight, tracking, case and line-height.
    "hud inline-flex w-fit shrink-0 items-center justify-center rounded-md",
    "cursor-pointer select-none whitespace-nowrap",
    "transition-[background-color,border-color,box-shadow,color] duration-200 ease-[var(--ease-duck)]",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    // aria-disabled as well as disabled: asChild renders an anchor, and an
    // anchor cannot be disabled.
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
  ],
  {
    variants: {
      variant: {
        /** The default read: a die-cut border, muted until touched. */
        outline:
          "sticker border-border bg-transparent text-muted-foreground hover:border-primary/60 hover:text-primary",
        /** For a row of chips dense enough that borders would be noise. */
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        /** One per group at most: the chip that commits something. */
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/92 hover:duck-glow-primary",
      },
      size: {
        sm: "hud-sm h-7 gap-1 px-2 [&_svg:not([class*='size-'])]:size-3",
        default: "h-9 gap-1.5 px-2.5",
      },
      active: { true: "", false: "" },
    },
    compoundVariants: [
      {
        variant: "outline",
        active: true,
        class: "border-primary/60 bg-primary/10 text-primary",
      },
      { variant: "ghost", active: true, class: "bg-secondary text-primary" },
      { variant: "primary", active: true, class: "duck-glow-primary" },
    ],
    defaultVariants: { variant: "outline", size: "default", active: false },
  }
);

export interface HudChipProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof hudChipVariants> {
  /**
   * Render the child element instead of a button — a next/link Link, an anchor.
   * The nav case, which is most of them.
   */
  asChild?: boolean;
}

function HudChip({
  className,
  variant = "outline",
  size = "default",
  active = false,
  asChild = false,
  disabled,
  ...props
}: HudChipProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      // type and disabled are button-only attributes. Handed to Slot they would
      // land on whatever element the consumer passed, so an anchor would come
      // out with type="button" and no disabled behaviour worth having: a nav
      // item that should not be reachable wants its href removed, not this.
      type={asChild ? undefined : "button"}
      disabled={asChild ? undefined : disabled}
      aria-disabled={asChild && disabled ? true : undefined}
      data-slot="hud-chip"
      data-variant={variant}
      data-size={size}
      data-active={active ? "" : undefined}
      className={cn(hudChipVariants({ variant, size, active }), className)}
      {...props}
    />
  );
}

export { HudChip, hudChipVariants };
