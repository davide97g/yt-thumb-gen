import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The official duck/ui mark. The registry ships the SVG into your `public/`,
 * so it is a same-origin request: the loading path still works offline and
 * under an `img-src 'self'` policy, which is exactly when a spinner matters.
 * (SVG rather than the site's PNG because the CLI inlines registry files as
 * text — a raster asset would arrive corrupt.) Point `src` at your own image
 * to brand the spinner, or edit this constant once to swap it everywhere —
 * DuckSpinner, QuackButton's loading state and QuackToast's quack variant all
 * read it.
 */
const DUCK_MARK_SRC = "/duck.svg";

type DuckGlyphProps = Omit<React.ComponentProps<"img">, "alt"> & {
  /** Any image URL: remote, /public path or data URI. */
  src?: string;
  /** Leave empty for decoration; the spinner already announces itself. */
  alt?: string;
};

/**
 * DuckGlyph — the mark as an image. Reused by the spinner and by loading
 * states, so one `src` covers every place the duck shows up.
 */
function DuckGlyph({
  className,
  src = DUCK_MARK_SRC,
  alt = "",
  ...props
}: DuckGlyphProps) {
  return (
    <img
      src={src}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      decoding="async"
      className={cn(
        "size-full shrink-0 select-none object-contain",
        className
      )}
      {...props}
    />
  );
}

const spinnerSizes = {
  sm: "size-5",
  default: "size-8",
  lg: "size-12",
} as const;

const spinnerMotion = {
  paddle: "[animation:duck-paddle_0.9s_ease-in-out_infinite]",
  spin: "animate-spin",
} as const;

/**
 * DuckSpinner — a duck paddling on water. The rings are the wake.
 */
function DuckSpinner({
  className,
  size = "default",
  motion = "paddle",
  src,
  label = "Loading",
  ...props
}: React.ComponentProps<"span"> & {
  size?: keyof typeof spinnerSizes;
  /** paddle rocks the mark, spin rotates it a full turn. */
  motion?: keyof typeof spinnerMotion;
  /** Custom mark image. Defaults to the duck/ui logo in your public folder. */
  src?: string;
  label?: string;
}) {
  return (
    <span
      data-slot="duck-spinner"
      role="status"
      aria-live="polite"
      className={cn(
        "relative inline-grid place-items-center",
        spinnerSizes[size],
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className="absolute size-full rounded-full border-2 border-primary/50 [animation:duck-ripple_1.6s_ease-out_infinite]"
      />
      <span
        aria-hidden
        className="absolute size-full rounded-full border-2 border-primary/40 [animation:duck-ripple_1.6s_ease-out_0.8s_infinite]"
      />
      <DuckGlyph src={src} className={cn("relative", spinnerMotion[motion])} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export { DuckSpinner, DuckGlyph, DUCK_MARK_SRC };
