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
}

function StickerKbd({ className, children, watch, meta, ...props }: StickerKbdProps) {
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
      className={cn(
        "inline-flex min-w-6 items-center justify-center rounded-md px-1.5 py-0.5",
        "font-mono text-[11px] leading-none font-semibold",
        "sticker border-border bg-card text-foreground select-none",
        // The lip is the cap's depth. Losing it and dropping by the same 2px is
        // what makes the key look pressed rather than merely recoloured.
        "shadow-[0_2px_0_var(--border)]",
        "transition-[box-shadow,transform] duration-75 ease-[var(--ease-duck)]",
        "active:translate-y-0.5 active:shadow-none",
        "data-[pressed]:translate-y-0.5 data-[pressed]:border-primary data-[pressed]:shadow-none",
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}

export { StickerKbd };
