import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * StickerProgress — the peel. Progress is a sticker coming off its backing
 * left to right: what is done is solid vinyl, what is left is cut-line dashes,
 * and the boundary between them is the peel edge.
 *
 * Lime only. A progress bar is on screen for the entire wait, so it is the
 * worst possible place to spend the viewport's one holo element.
 *
 * Two sizes, and the track ships on its own as StickerProgressTrack. Overlaid
 * along the bottom edge of artwork there is no room for a label row and no room
 * for the wrapper, and the height has to be overridable from outside — which is
 * exactly what the composite version cannot offer.
 */

const tracks = {
  // The dashes need about 9px of interior to read as a cut line; a 1.5px border
  // top and bottom would leave 1px of a 4px track. So sm trades them for a dim
  // solid backing, which is what a sticker looks like before it is cut anyway.
  sm: "h-1 bg-secondary",
  default: "h-3 cut-line bg-transparent",
} as const;

const edges = {
  sm: "w-[2px]",
  default: "w-[3px]",
} as const;

const toPercent = (value: number, max: number) =>
  Math.min(100, Math.max(0, (value / max) * 100));

export interface StickerProgressTrackProps
  extends Omit<React.ComponentProps<"div">, "children"> {
  /** 0 to max. Omit for indeterminate. */
  value?: number;
  max?: number;
  size?: "sm" | "default";
  /** Accessible name only — the bare track never prints it. */
  label?: string;
}

/**
 * The bare bar: one role="progressbar" element and nothing around it, so it can
 * be absolutely positioned over an image and have its radius and height
 * rewritten by className.
 */
function StickerProgressTrack({
  className,
  value,
  max = 100,
  size = "default",
  label,
  ...props
}: StickerProgressTrackProps) {
  const indeterminate = value === undefined;
  const percent = indeterminate ? 0 : toPercent(value, max);

  return (
    <div
      data-slot="sticker-progress-track"
      data-size={size}
      role="progressbar"
      aria-label={label ?? "Progress"}
      aria-busy={indeterminate || undefined}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : value}
      className={cn(
        "relative w-full overflow-hidden rounded-full",
        tracks[size],
        indeterminate &&
          "border-primary/40 bg-[linear-gradient(105deg,transparent_38%,var(--primary)_50%,transparent_62%)] bg-[length:280%_100%] [animation:duck-shimmer_1.4s_ease-in-out_infinite]",
        className
      )}
      {...props}
    >
      {!indeterminate && (
        <div
          style={{ width: `${percent}%` }}
          className="relative h-full rounded-full bg-primary transition-[width] duration-500 ease-[var(--ease-duck)]"
        >
          {/* The peel edge: vinyl catches the light where it lifts. */}
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 right-0 rounded-full bg-vinyl opacity-70",
              edges[size]
            )}
          />
        </div>
      )}
    </div>
  );
}

export interface StickerProgressProps extends StickerProgressTrackProps {
  /** Prints above the track, and becomes the accessible name. */
  label?: string;
  /** Print the percentage next to the label, in tabular figures. */
  showValue?: boolean;
}

function StickerProgress({
  className,
  value,
  max = 100,
  size = "default",
  label,
  showValue = false,
  ...props
}: StickerProgressProps) {
  const indeterminate = value === undefined;
  const percent = indeterminate ? 0 : toPercent(value, max);

  return (
    <div
      data-slot="sticker-progress"
      data-size={size}
      className={cn("flex w-full flex-col gap-1.5", className)}
      {...props}
    >
      {(label || showValue) && (
        <div className="flex items-baseline justify-between gap-3 text-xs">
          {label && <span className="font-medium">{label}</span>}
          {showValue && !indeterminate && (
            <span className="font-mono tabular-nums text-muted-foreground">
              {Math.round(percent)}%
            </span>
          )}
        </div>
      )}

      <StickerProgressTrack value={value} max={max} size={size} label={label} />
    </div>
  );
}

export { StickerProgress, StickerProgressTrack };
