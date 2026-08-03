"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * StickerKbd — a keycap is already a die-cut object, so it needs no invention:
 * a 3px edge and a 2px hard bottom lip that compresses to nothing when the key
 * goes down. Pass `watch` and it depresses on the real keystroke, not just on
 * the mouse — the cap moves at the moment the user's finger does.
 *
 * All of the motion is reactive, so it costs nothing against the one-idle-
 * animation-per-viewport rule.
 */
export interface StickerKbdProps extends React.ComponentProps<"kbd"> {
  /**
   * A KeyboardEvent.key to listen for, case-insensitive — "k", "Enter",
   * "Escape". The cap presses while that key is held anywhere on the page.
   */
  watch?: string;
  /** Also require the platform's command key: Meta on Apple, Control elsewhere. */
  meta?: boolean;
  /**
   * Draw the die-cut edge and the lip. Off for a keycap printed inside a tooltip
   * or a menu row, where a third border is noise. Same prop, same reason, as on
   * GlowInput: `.sticker` lands at the end of the utilities layer, so a
   * `border-0` at the call site loses on order. `sticker-none` is the
   * class-level version.
   */
  frame?: boolean;
}

function StickerKbd({
  className,
  children,
  watch,
  meta,
  frame = true,
  ...props
}: StickerKbdProps) {
  const [down, setDown] = React.useState(false);

  React.useEffect(() => {
    if (!watch) return;
    const wanted = watch.toLowerCase();
    const matches = (event: KeyboardEvent) =>
      event.key.toLowerCase() === wanted &&
      (!meta || event.metaKey || event.ctrlKey);

    const onDown = (event: KeyboardEvent) => matches(event) && setDown(true);
    const onUp = (event: KeyboardEvent) => matches(event) && setDown(false);
    // A held key that loses the window never fires keyup.
    const onBlur = () => setDown(false);

    document.addEventListener("keydown", onDown);
    document.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [watch, meta]);

  return (
    <kbd
      data-slot="sticker-kbd"
      data-pressed={down || undefined}
      data-frame={frame ? "sticker" : "bare"}
      className={cn(
        "inline-flex min-w-6 items-center justify-center rounded-md px-1.5 py-0.5",
        "font-mono text-[11px] leading-none font-semibold",
        "bg-card text-foreground select-none",
        frame && "sticker border-border",
        // The lip is the cap's depth. Losing it and dropping by the same 2px is
        // what makes the key look pressed rather than merely recoloured. A
        // frameless cap has no edge for a lip to belong to, so it only recolours.
        frame && [
          "shadow-[0_2px_0_var(--border)]",
          "active:translate-y-0.5 active:shadow-none",
          "data-[pressed]:translate-y-0.5 data-[pressed]:shadow-none",
        ],
        "transition-[box-shadow,transform,border-color,color] duration-75 ease-[var(--ease-duck)]",
        frame
          ? "data-[pressed]:border-primary"
          : "data-[pressed]:text-primary",
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}

export { StickerKbd };
