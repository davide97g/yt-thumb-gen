import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DuckMark — the mascot as flat vector.
 *
 * DuckGlyph, over in duck-spinner, is the photographic logo: it carries a
 * transparent halo and is tuned to read at 16px on a button. Blown up to the
 * 96px an empty state wants, that halo shows. This is the same duck drawn as
 * geometry, so it stays crisp at any size, inherits colour from currentColor,
 * and adds nothing to the bundle.
 *
 *   rest   sitting still
 *   swim   sitting on two lines of water
 *
 * The beak and eye are the only literal colours in the registry. They are not
 * semantic — a duck's beak is not "accent", it is orange — which is the same
 * exception HoloAvatar's away dot already takes.
 */
export interface DuckMarkProps extends React.ComponentProps<"svg"> {
  pose?: "rest" | "swim";
}

function DuckMark({ className, pose = "rest", ...props }: DuckMarkProps) {
  return (
    <svg
      data-slot="duck-mark"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      className={cn("size-10 text-primary", className)}
      {...props}
    >
      {/* tail */}
      <path d="M10 36 L1 30 L9 46 Z" fill="currentColor" />
      {/* body */}
      <ellipse cx="28" cy="41" rx="21" ry="12.5" fill="currentColor" />
      {/* head */}
      <circle cx="43" cy="21" r="11" fill="currentColor" />
      {/* beak */}
      <path d="M52 17.5 L63.5 21.8 L52 26 Z" fill="oklch(0.75 0.17 62)" />
      {/* wing */}
      <path
        d="M17 41 q9 7.5 20 1"
        stroke="oklch(0.2 0.01 285 / 0.32)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* eye */}
      <circle cx="45.5" cy="18" r="2.3" fill="oklch(0.2 0.01 285)" />

      {pose === "swim" && (
        <>
          <path
            d="M4 52 h24"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.35"
          />
          <path
            d="M34 52 h26"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.2"
          />
        </>
      )}
    </svg>
  );
}

export { DuckMark };
