"use client";

import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";
import { useHoloPointer } from "@/hooks/use-holo-pointer";

/**
 * StickerCard — the die-cut sticker: thick border, generous radius, soft glow.
 *
 *   holo     iridescent ring instead of the solid border
 *   tilt     the card leans toward the pointer
 *   peel     a corner lifts off the backing on hover
 *   ticks    corner brackets that fade in on hover
 *   glass    translucent surface over whatever is behind it
 *   asChild  render as the child element, for a whole-card link
 *   frame    off drops the edge for a card nested inside another surface
 */
function StickerCard({
  className,
  holo = false,
  tilt = false,
  peel = false,
  ticks = false,
  glass = false,
  frame = true,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  holo?: boolean;
  tilt?: boolean;
  peel?: boolean;
  ticks?: boolean;
  glass?: boolean;
  /**
   * Draw the die-cut edge. Off for a card inside a card, or a panel whose
   * container is already the frame — the fill, the radius and the padding stay.
   * The same prop, for the same reason, as on GlowInput: `.sticker` is declared
   * at the end of the utilities layer, so a `border-0` at the call site loses on
   * order. `sticker-none` is the class-level version.
   */
  frame?: boolean;
  asChild?: boolean;
}) {
  const ref = useHoloPointer<HTMLDivElement>({ tilt: 5, disabled: !tilt });
  // A whole-card link is the commonest surface on a content site, and without
  // this the only way to express it was to keep a hand-rolled .panel class.
  // StickerMediaCard already had it; these two are the same idea.
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      ref={ref}
      data-slot="sticker-card"
      data-variant={holo ? "holo" : "solid"}
      data-frame={frame ? "sticker" : "bare"}
      className={cn(
        "group/sticker relative flex flex-col gap-4 rounded-2xl p-6 text-card-foreground",
        "transition-[box-shadow,border-color] duration-300 ease-[var(--ease-duck)]",
        // The fill and the edge are one declaration on a holo card — a
        // padding-box gradient — so the translucent case has to restate it
        // rather than layer a background colour under it. Frameless, there is no
        // border box to paint a gradient into, so holo has nothing to say.
        !frame
          ? glass
            ? "bg-[var(--glass)]"
            : "bg-card"
          : holo
            ? glass
              ? "holo-border [background:linear-gradient(var(--glass),var(--glass))_padding-box,var(--holo)_border-box] hover:duck-glow"
              : "holo-border bg-card hover:duck-glow"
            : cn(
                "sticker border-border hover:border-primary/50 hover:duck-glow-primary",
                glass ? "bg-[var(--glass)]" : "bg-card"
              ),
        glass && "backdrop-blur-[var(--glass-blur,12px)]",
        tilt && "tilt data-[holo=active]:tilt-live",
        peel && "overflow-hidden",
        className
      )}
      {...props}
    >
      {/* Slot appends whatever follows the Slottable to the cloned child, so
          the decorations land inside the consumer's <a> rather than beside it
          — and Slot counts children with React.Children.only, so a bare
          {children} plus one conditional span throws even when the span
          renders nothing. */}
      {asChild ? <Slottable>{children}</Slottable> : children}
      {ticks && (
        // Four 8px brackets in the accent colour. They cost nothing and they
        // are the difference between a rectangle and an instrument.
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[inherit] opacity-0",
            "transition-opacity duration-300 ease-[var(--ease-duck)]",
            "group-hover/sticker:opacity-100",
            "[&>span]:absolute [&>span]:size-2 [&>span]:border-primary"
          )}
        >
          <span className="top-0 left-0 border-t-2 border-l-2" />
          <span className="top-0 right-0 border-t-2 border-r-2" />
          <span className="bottom-0 left-0 border-b-2 border-l-2" />
          <span className="right-0 bottom-0 border-r-2 border-b-2" />
        </span>
      )}
      {peel && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-0 bottom-0 size-12 origin-bottom-right scale-0 rounded-br-[inherit]",
            "bg-[linear-gradient(315deg,var(--muted)_42%,var(--border)_50%,var(--background)_58%)]",
            "[clip-path:polygon(100%_0,100%_100%,0_100%)]",
            "shadow-[-6px_-6px_18px_oklch(0_0_0/0.28)]",
            "transition-transform duration-400 ease-[var(--ease-duck)]",
            "group-hover/sticker:scale-100"
          )}
        />
      )}
    </Comp>
  );
}

function StickerCardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sticker-card-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function StickerCardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="sticker-card-title"
      className={cn(
        "font-display text-lg leading-none font-bold tracking-tight",
        className
      )}
      {...props}
    />
  );
}

function StickerCardDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="sticker-card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function StickerCardContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div data-slot="sticker-card-content" className={cn(className)} {...props} />
  );
}

function StickerCardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sticker-card-footer"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  );
}

export {
  StickerCard,
  StickerCardHeader,
  StickerCardTitle,
  StickerCardDescription,
  StickerCardContent,
  StickerCardFooter,
};
