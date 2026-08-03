"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DuckSwitch — the duck entering the water.
 *
 * Off, it rests on the bank: an empty track with the 3px vinyl outline. On, it
 * slides in, the track floods lime, and one ripple spreads from the entry point
 * and dies. The knob travels further than its own width, so the state is
 * readable without colour.
 *
 * It is a real checkbox underneath, so it submits with the form, pairs with a
 * <label>, and gets Space for free. Enter is added, per the ARIA switch pattern.
 */

/**
 * The knob lives inside the track, so peer-* cannot reach it directly — peer
 * variants only match siblings. The track claims the state and hands the knob
 * its travel through a variable, the same way QuackButton composes transforms.
 */
const trackSizes = {
  sm: "h-5 w-9 peer-checked:[--travel:16px]",
  default: "h-6 w-11 peer-checked:[--travel:22px]",
} as const;

const knobSizes = {
  sm: "size-3",
  default: "size-4",
} as const;

export interface DuckSwitchProps
  extends Omit<React.ComponentProps<"input">, "type" | "size"> {
  size?: keyof typeof trackSizes;
  /** Visible label. Without one, pass an aria-label. */
  children?: React.ReactNode;
}

function DuckSwitch({
  className,
  size = "default",
  children,
  onChange,
  onKeyDown,
  ...props
}: DuckSwitchProps) {
  const trackRef = React.useRef<HTMLSpanElement>(null);

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(event);
      // The wake only happens on the way in.
      if (!event.currentTarget.checked) return;
      const track = trackRef.current;
      if (!track) return;
      const drop = document.createElement("span");
      // No translate utilities here: duck-ripple animates transform, and a
      // centring translate would be thrown away the moment it starts.
      drop.className =
        "pointer-events-none absolute inset-y-0 right-0 aspect-square rounded-full bg-vinyl [animation:duck-ripple_0.5s_ease-out_forwards]";
      drop.addEventListener("animationend", () => drop.remove(), { once: true });
      track.appendChild(drop);
    },
    [onChange]
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);
      if (event.key !== "Enter" || event.defaultPrevented) return;
      // A checkbox ignores Enter and lets the form submit. A switch shouldn't.
      event.preventDefault();
      event.currentTarget.click();
    },
    [onKeyDown]
  );

  return (
    <label
      data-slot="duck-switch"
      data-size={size}
      className={cn(
        "inline-flex cursor-pointer items-center gap-3 text-sm select-none",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
        className
      )}
    >
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        {...props}
      />
      <span
        ref={trackRef}
        aria-hidden
        className={cn(
          "relative flex shrink-0 items-center overflow-hidden rounded-full",
          // The off state cannot lean on the fill: muted on card is ~1.2:1.
          // The 3px sticker edge is what actually draws the boundary.
          "sticker border-border bg-transparent",
          "transition-[background-color,border-color] duration-300 ease-[var(--ease-duck)]",
          "peer-checked:border-primary peer-checked:bg-primary",
          "peer-active:[animation:duck-squash_0.3s_var(--ease-squash)]",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
          trackSizes[size]
        )}
      >
        <span
          className={cn(
            "pointer-events-none relative z-10 ml-px rounded-full bg-vinyl shadow-[0_1px_2px_oklch(0_0_0/0.3)]",
            "translate-x-[var(--travel,0px)] transition-transform duration-300 ease-[var(--ease-squash)]",
            knobSizes[size]
          )}
        />
      </span>
      {children}
    </label>
  );
}

export { DuckSwitch };
