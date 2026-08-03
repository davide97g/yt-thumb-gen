"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * StickerDialog — the sticker lifted off the page.
 *
 * Radix Dialog underneath, the same way DuckSwitch is a real checkbox
 * underneath: a modal owes a focus trap, a scroll lock, an escape handler,
 * `aria-modal` and a labelled title, and none of that is worth reinventing to
 * get a thicker border.
 *
 * What duck adds is the arrival. The scrim goes to frosted black, the panel
 * rises a few pixels into place on --ease-duck, and the die-cut edge lights in
 * lime — one motion, no bounce. Dialogs interrupt; they do not get to be
 * playful about it, so there is no squash here and no idle animation once it
 * has landed.
 *
 * `size` is the width cap, except at `full`, which is a different panel: it
 * drops the centring translate for `inset-0` and fades instead of rising,
 * because duck-dialog-in carries that translate through every frame and would
 * otherwise throw a full-bleed panel across the viewport. Anchor a panel to an
 * edge with StickerDrawer instead of pushing `full` around with class
 * overrides.
 */

const StickerDialog = DialogPrimitive.Root;
const StickerDialogTrigger = DialogPrimitive.Trigger;
const StickerDialogClose = DialogPrimitive.Close;
const StickerDialogPortal = DialogPrimitive.Portal;

function StickerDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sticker-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-[oklch(0_0_0/0.65)] backdrop-blur-sm",
        // Radix keeps the node mounted until the closing animation ends, so
        // both directions are real rather than a fade-in and a hard cut.
        "data-[state=open]:[animation:duck-fade-in_0.2s_var(--ease-duck)]",
        "data-[state=closed]:[animation:duck-fade-out_0.18s_var(--ease-duck)]",
        className
      )}
      {...props}
    />
  );
}

type StickerDialogSize = "sm" | "default" | "lg" | "full";

const MAX_WIDTH: Record<StickerDialogSize, string> = {
  sm: "max-w-sm",
  default: "max-w-lg",
  lg: "max-w-2xl",
  full: "max-w-none",
};

export interface StickerDialogContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content> {
  /** Width cap. `full` is a full-bleed panel edge to edge. */
  size?: StickerDialogSize;
  /** Iridescent ring instead of the solid die-cut edge. */
  holo?: boolean;
  /**
   * Hide the built-in close button. Only do this when the dialog is a blocking
   * decision and the actions inside it are the sole way out — Escape and the
   * overlay still dismiss unless you also intercept those.
   */
  hideClose?: boolean;
  /** Accessible name for the close button. */
  closeLabel?: string;
}

function StickerDialogContent({
  className,
  children,
  size = "default",
  holo = false,
  hideClose = false,
  closeLabel = "Close",
  ...props
}: StickerDialogContentProps) {
  return (
    <StickerDialogPortal>
      <StickerDialogOverlay />
      <DialogPrimitive.Content
        data-slot="sticker-dialog-content"
        data-size={size}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-card p-6 text-card-foreground",
          holo ? "holo-border duck-glow" : "sticker border-border duck-glow-primary",
          MAX_WIDTH[size],
          size === "full"
            ? [
                // Nothing to centre, so nothing to carry: a plain fade, and the
                // panel owns its own scrolling because it is the viewport now.
                "inset-0 overflow-y-auto rounded-none",
                "data-[state=open]:[animation:duck-fade-in_0.24s_var(--ease-duck)]",
                "data-[state=closed]:[animation:duck-fade-out_0.18s_var(--ease-duck)]",
              ]
            : [
                "top-1/2 left-1/2 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl",
                // Composed with the centring translate, so the rise has to be a
                // keyframe of its own rather than a transform utility.
                "data-[state=open]:[animation:duck-dialog-in_0.28s_var(--ease-duck)]",
                "data-[state=closed]:[animation:duck-dialog-out_0.18s_var(--ease-duck)]",
              ],
          className
        )}
        {...props}
      >
        {children}

        {!hideClose && (
          <DialogPrimitive.Close
            data-slot="sticker-dialog-close"
            aria-label={closeLabel}
            className={cn(
              "absolute top-4 right-4 grid size-8 cursor-pointer place-items-center rounded-md",
              "text-muted-foreground transition-colors duration-200 ease-[var(--ease-duck)]",
              "hover:bg-secondary hover:text-foreground",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </StickerDialogPortal>
  );
}

function StickerDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sticker-dialog-header"
      // Reserves the close button's gutter so a long title never runs under it.
      className={cn("flex flex-col gap-1.5 pr-8", className)}
      {...props}
    />
  );
}

function StickerDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sticker-dialog-title"
      className={cn(
        "font-display text-lg leading-none font-bold tracking-tight",
        className
      )}
      {...props}
    />
  );
}

function StickerDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sticker-dialog-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

function StickerDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sticker-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}

export {
  StickerDialog,
  StickerDialogTrigger,
  StickerDialogClose,
  StickerDialogPortal,
  StickerDialogOverlay,
  StickerDialogContent,
  StickerDialogHeader,
  StickerDialogTitle,
  StickerDialogDescription,
  StickerDialogFooter,
};
