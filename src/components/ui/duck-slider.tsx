"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DuckSlider — the waterline.
 *
 * The filled track is water, the thumb is the duck floating on it, and letting
 * go leaves a wake that spreads and dies. No foil here: an iridescent track
 * would be decoration pretending to be metaphor, and sliders come in sixes.
 *
 * It is a real <input type="range">, which is the whole point. Arrow keys,
 * PageUp/PageDown, Home/End, touch dragging without stealing the page scroll,
 * and RTL where Left increases — all of it is browser behaviour that a div
 * with role="slider" would have to reimplement and would get wrong.
 *
 * Single value only. A two-thumb range needs a different control; this is not
 * that control pretending.
 */
export interface DuckSliderProps
  extends Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue"> {
  value?: number;
  defaultValue?: number;
  /**
   * Turns the raw number into something a screen reader can read out —
   * "120 ms", "Large". Without it the user hears a bare integer.
   */
  formatValue?: (value: number) => string;
  /** Show the formatted value above the track. */
  showValue?: boolean;
}

function DuckSlider({
  className,
  value,
  defaultValue = 0,
  min = 0,
  max = 100,
  step = 1,
  formatValue,
  showValue = false,
  onChange,
  onPointerUp,
  ...props
}: DuckSliderProps) {
  const controlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue);
  const current = controlled ? value : internal;
  const wakeRef = React.useRef<HTMLDivElement>(null);

  const lower = Number(min);
  const upper = Number(max);
  const fill = upper === lower ? 0 : ((current - lower) / (upper - lower)) * 100;
  const readable = formatValue?.(current);

  /**
   * A native range insets the thumb by half its width at both ends, so a plain
   * percentage would leave the water short of the duck at 0 and past it at 100.
   * This is the same percentage, corrected back onto the thumb's centre.
   */
  const THUMB = 18;
  const waterline = `calc(${fill}% + ${((0.5 - fill / 100) * THUMB).toFixed(2)}px)`;

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!controlled) setInternal(event.currentTarget.valueAsNumber);
      onChange?.(event);
    },
    [controlled, onChange]
  );

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLInputElement>) => {
      onPointerUp?.(event);
      const host = wakeRef.current;
      if (!host) return;
      const drop = document.createElement("span");
      // duck-ripple animates transform, so the placement has to be in px —
      // a centring translate utility would be overwritten on the first frame.
      const size = 28;
      drop.className =
        "pointer-events-none absolute top-1/2 rounded-full bg-primary [animation:duck-ripple_0.45s_ease-out_forwards]";
      drop.style.width = drop.style.height = `${size}px`;
      drop.style.marginTop = `${-size / 2}px`;
      drop.style.left = `calc(${waterline} - ${size / 2}px)`;
      drop.addEventListener("animationend", () => drop.remove(), { once: true });
      host.appendChild(drop);
    },
    [onPointerUp, waterline]
  );

  return (
    <div
      data-slot="duck-slider"
      className={cn("flex w-full flex-col gap-2", className)}
    >
      {showValue && (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {readable ?? current}
        </span>
      )}
      <div ref={wakeRef} className="relative flex h-5 items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={controlled ? value : undefined}
          defaultValue={controlled ? undefined : defaultValue}
          aria-valuetext={readable}
          onChange={handleChange}
          onPointerUp={handlePointerUp}
          style={{ "--fill": waterline } as React.CSSProperties}
          className={cn(
            "peer h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary outline-none",
            "bg-[linear-gradient(to_right,var(--primary)_var(--fill),var(--secondary)_var(--fill))]",
            "rtl:bg-[linear-gradient(to_left,var(--primary)_var(--fill),var(--secondary)_var(--fill))]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            // The thumb is the duck. It is drawn at 18px and given a 24px grab
            // area by the invisible border, so the tap target clears WCAG 2.5.8
            // without the duck growing.
            "[&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-vinyl",
            "[&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-primary",
            "[&::-webkit-slider-thumb]:shadow-[0_1px_3px_oklch(0_0_0/0.35)]",
            "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150",
            "active:[&::-webkit-slider-thumb]:scale-115",
            "[&::-moz-range-thumb]:size-[18px] [&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-primary",
            "[&::-moz-range-thumb]:bg-vinyl",
            "[&::-moz-range-track]:bg-transparent",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          )}
          {...props}
        />
      </div>
    </div>
  );
}

export { DuckSlider };
