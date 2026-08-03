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

const LOG_STEPS = 1000;

/** How many decimals the grain has, so quantising cannot leak 0.30000000000004. */
function decimalsOf(step: number) {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

export interface DuckSliderProps
  extends Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue"> {
  value?: number;
  defaultValue?: number;
  /**
   * Turns the raw number into something a screen reader can read out —
   * "120 ms", "Large". Without it the user hears a bare integer.
   */
  formatValue?: (value: number) => string;
  /** Show the formatted value. */
  showValue?: boolean;
  /**
   * Where that value goes. `above` is a line of its own over the track; `row`
   * puts it at the end of the label row, right-aligned in tabular mono, which is
   * what a control rail wants — a dragging slider never reflows the row it sits
   * in, and 40 of them stay a fixed height.
   */
  valuePosition?: "above" | "row";
  /**
   * The control's name, rendered as a real <label> tied to the input. Pass it
   * and the readout, the label and `action` share one row.
   */
  label?: React.ReactNode;
  /** Trailing affordance on the label row — a reset button, a lock, a menu. */
  action?: React.ReactNode;
  /**
   * How position maps to value. A font size running 12→400 or a scale running
   * 0.05→8 is unusable linear: the useful half of the range is the first 15% of
   * the track, which is why every editor writes the geometric mapping by hand,
   * drives the slider in fake integer positions, and then has to lie in
   * `min`/`max`/`step` and patch the screen-reader text back up.
   *
   * `log` owns that mapping. The track is uniform in log space, `step` stays the
   * grain of the *reported* value, and `aria-valuetext` reports the real number
   * rather than the position. Needs `min > 0` — a logarithm has nowhere to put
   * zero — and falls back to linear if it does not get one.
   */
  curve?: "linear" | "log";
  /**
   * The value, already mapped. This is the channel to wire on a log slider: the
   * input's own `valueAsNumber` is a track position there, so `onChange` still
   * fires but carries the position, not the value.
   */
  onValueChange?: (value: number) => void;
}

function DuckSlider({
  className,
  id,
  value,
  defaultValue = 0,
  min = 0,
  max = 100,
  step = 1,
  formatValue,
  showValue = false,
  valuePosition = "above",
  label,
  action,
  curve = "linear",
  onChange,
  onValueChange,
  onPointerUp,
  ...props
}: DuckSliderProps) {
  const controlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue);
  const current = controlled ? value : internal;
  const wakeRef = React.useRef<HTMLDivElement>(null);
  const generatedId = React.useId();
  const inputId = id ?? (label ? generatedId : undefined);

  const lower = Number(min);
  const upper = Number(max);
  const grain = Number(step);

  /**
   * A log track needs a positive, ordered domain. Rather than render something
   * that silently misplaces the thumb, it degrades to the linear track it would
   * have been — and says so, once, where a developer will see it.
   */
  const logUsable = lower > 0 && upper > lower;
  const log = curve === "log" && logUsable;
  if (process.env.NODE_ENV !== "production" && curve === "log" && !logUsable) {
    console.warn(
      `DuckSlider: curve="log" needs min > 0 and max > min, got min=${min} max=${max}. Falling back to linear.`
    );
  }

  const toPosition = React.useCallback(
    (real: number) => {
      const clamped = Math.min(Math.max(real, lower), upper);
      return Math.round(
        (Math.log(clamped / lower) / Math.log(upper / lower)) * LOG_STEPS
      );
    },
    [lower, upper]
  );

  const fromPosition = React.useCallback(
    (position: number) => {
      const real =
        lower * Math.pow(upper / lower, position / LOG_STEPS);
      const bounded = Math.min(Math.max(real, lower), upper);
      // `step` keeps its meaning — the grain of the value the caller receives —
      // even though the input's own step is one track position.
      if (!Number.isFinite(grain) || grain <= 0) return bounded;
      const snapped = Math.round(bounded / grain) * grain;
      return Number(
        Math.min(Math.max(snapped, lower), upper).toFixed(decimalsOf(grain))
      );
    },
    [grain, lower, upper]
  );

  const position = log ? toPosition(current) : current;
  const fill = log
    ? (position / LOG_STEPS) * 100
    : upper === lower
      ? 0
      : ((current - lower) / (upper - lower)) * 100;
  // A log track's value is a position, so the bare number a screen reader would
  // otherwise read out is meaningless. It always gets text.
  const readable = formatValue?.(current) ?? (log ? String(current) : undefined);

  /**
   * A native range insets the thumb by half its width at both ends, so a plain
   * percentage would leave the water short of the duck at 0 and past it at 100.
   * This is the same percentage, corrected back onto the thumb's centre.
   */
  const THUMB = 18;
  const waterline = `calc(${fill}% + ${((0.5 - fill / 100) * THUMB).toFixed(2)}px)`;

  /**
   * A log track has 1000 positions and a value grain of its own, and the two do
   * not line up: on a 12→400 range one position is 0.04px at the bottom and
   * 1.4px at the top, so 24 arrow presses down there used to quantise back to
   * the value the slider already had — the input is controlled, so the thumb
   * snapped home and the key looked broken. Walking on in the direction of
   * travel until the value actually changes makes one press worth one `step`,
   * which is what the key promises.
   */
  const nextLogValue = React.useCallback(
    (raw: number) => {
      const candidate = fromPosition(raw);
      if (candidate !== current || raw === position) return candidate;
      const direction = raw > position ? 1 : -1;
      let probe = raw;
      let walked = candidate;
      while (walked === current && probe > 0 && probe < LOG_STEPS) {
        probe += direction;
        walked = fromPosition(probe);
      }
      return walked;
    },
    [current, fromPosition, position]
  );

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.currentTarget.valueAsNumber;
      const next = log ? nextLogValue(raw) : raw;
      if (!controlled) setInternal(next);
      onValueChange?.(next);
      onChange?.(event);
    },
    [controlled, log, nextLogValue, onChange, onValueChange]
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

  const readout = showValue && (
    <span
      data-slot="duck-slider-value"
      className="font-mono text-xs tabular-nums text-muted-foreground"
    >
      {readable ?? current}
    </span>
  );
  const inRow = valuePosition === "row";
  const hasRow = Boolean(label) || Boolean(action) || (showValue && inRow);

  return (
    <div
      data-slot="duck-slider"
      className={cn("flex w-full flex-col gap-2", className)}
    >
      {hasRow && (
        <div className="flex min-h-6 items-center justify-between gap-2">
          {label ? (
            <label
              htmlFor={inputId}
              data-slot="duck-slider-label"
              className="truncate text-xs font-medium text-foreground"
            >
              {label}
            </label>
          ) : (
            <span />
          )}
          <span className="flex shrink-0 items-center gap-1">
            {inRow && readout}
            {action}
          </span>
        </div>
      )}
      {!inRow && readout}
      <div ref={wakeRef} className="relative flex h-5 items-center">
        <input
          type="range"
          id={inputId}
          // On a log track these three describe the track, not the value. The
          // value is what aria-valuetext says.
          min={log ? 0 : min}
          max={log ? LOG_STEPS : max}
          step={log ? 1 : step}
          value={position}
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
