"use client";

import * as React from "react";
import { Pipette } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  GLOW_FIELD_FRAME,
  type GlowFrameProps,
} from "@/components/ui/glow-input";

/**
 * GlowColor — the last raw HTML input in a design tool.
 *
 * `input[type="color"]` is unstyleable enough that every project writes the same
 * four rules: `appearance: none`, the swatch wrapper's padding, the inner
 * radius, and the border it draws whatever the border utilities say. They live
 * here now, as arbitrary variants, so the swatch is a die-cut object like every
 * other duck field instead of an OS control sitting in the middle of one.
 *
 * The eyedropper is the other twenty lines every design tool writes. It is
 * Chromium-only (`window.EyeDropper`), so the control is rendered from a mounted
 * effect rather than from a `typeof window` check — a server render that guessed
 * would either flash a button Firefox cannot honour or hydrate a mismatch.
 *
 * A picked colour arrives with no DOM event behind it, so it reports through
 * `onValueChange` and not through `onChange`. Wire `onValueChange` if you use
 * the eyedropper at all; `onChange` stays the swatch's own native event, for a
 * form that reads the input directly.
 */

/* The API is not in lib.dom yet. Two lines, and `open()` rejects on Escape. */
interface EyeDropperOpenResult {
  sRGBHex: string;
}
interface EyeDropperInstance {
  open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperOpenResult>;
}
declare global {
  interface Window {
    EyeDropper?: new () => EyeDropperInstance;
  }
}

const HEX = /^#?([0-9a-f]{3,8})$/i;

/**
 * `input[type="color"]` accepts exactly `#rrggbb` and silently renders anything
 * else as black, which is how a `#fff` default becomes a black swatch with no
 * error anywhere. Shorthand is expanded, an alpha pair is dropped — the control
 * has no alpha channel — and anything unparseable falls back rather than
 * poisoning the value.
 */
function normalizeHex(input: string | undefined, fallback = "#000000") {
  if (!input) return fallback;
  const match = HEX.exec(input.trim());
  if (!match) return fallback;
  const digits = match[1].toLowerCase();
  if (digits.length === 3 || digits.length === 4) {
    return `#${digits
      .slice(0, 3)
      .split("")
      .map((digit) => digit + digit)
      .join("")}`;
  }
  if (digits.length === 6 || digits.length === 8) return `#${digits.slice(0, 6)}`;
  return fallback;
}

const swatchSizes = {
  /** The rail size, beside a 28px icon button. */
  sm: "size-8",
  default: "size-10",
} as const;

export interface GlowColorProps
  extends Omit<
      React.ComponentProps<"input">,
      "type" | "value" | "defaultValue" | "size" | "children"
    >,
    GlowFrameProps {
  /** `#rrggbb`. Shorthand and an alpha pair are accepted and normalised. */
  value?: string;
  defaultValue?: string;
  /** Fires for the swatch and for an eyedropper pick, always as `#rrggbb`. */
  onValueChange?: (hex: string) => void;
  size?: keyof typeof swatchSizes;
  /** Offer the eyedropper where the browser has one. */
  eyedropper?: boolean;
  eyedropperLabel?: string;
  /** Print the hex beside the swatch, in tabular mono. */
  showValue?: boolean;
  /** Sits on the row. The swatch keeps its own size. */
  className?: string;
  swatchClassName?: string;
}

function GlowColor({
  value,
  defaultValue = "#000000",
  onValueChange,
  onChange,
  frame = true,
  size = "default",
  eyedropper = true,
  eyedropperLabel = "Pick a colour from the screen",
  showValue = false,
  className,
  swatchClassName,
  disabled,
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  ...props
}: GlowColorProps) {
  const controlled = value !== undefined;
  const [internal, setInternal] = React.useState(() => normalizeHex(defaultValue));
  const current = normalizeHex(controlled ? value : internal, internal);
  const [canPick, setCanPick] = React.useState(false);

  React.useEffect(() => {
    setCanPick(typeof window !== "undefined" && Boolean(window.EyeDropper));
  }, []);

  const commit = React.useCallback(
    (hex: string) => {
      const next = normalizeHex(hex, current);
      if (!controlled) setInternal(next);
      onValueChange?.(next);
    },
    [controlled, current, onValueChange]
  );

  const pick = async () => {
    const Picker = window.EyeDropper;
    if (!Picker) return;
    try {
      const { sRGBHex } = await new Picker().open();
      commit(sRGBHex);
    } catch {
      // Escape and a dismissed picker both reject. Neither is an error, and
      // neither should change the value.
    }
  };

  return (
    <div
      data-slot="glow-color"
      className={cn("flex items-center gap-2", className)}
    >
      <input
        type="color"
        id={id}
        data-slot="glow-color-swatch"
        data-frame={frame ? "sticker" : "bare"}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        value={current}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (!controlled) setInternal(normalizeHex(next, current));
          onChange?.(event);
          onValueChange?.(normalizeHex(next, current));
        }}
        className={cn(
          "shrink-0 cursor-pointer appearance-none bg-transparent p-0 outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          swatchSizes[size],
          // The four rules. The wrapper's padding and the swatch's own border
          // are what make a bare input[type=color] look like a beveled OS
          // control; without them the die-cut edge sits around a second frame.
          "[&::-webkit-color-swatch-wrapper]:p-0",
          "[&::-webkit-color-swatch]:rounded-[calc(var(--radius-md)_-_var(--sticker-width,var(--sticker-border)))]",
          "[&::-webkit-color-swatch]:border-0",
          "[&::-moz-color-swatch]:rounded-[calc(var(--radius-md)_-_var(--sticker-width,var(--sticker-border)))]",
          "[&::-moz-color-swatch]:border-0",
          frame
            ? [GLOW_FIELD_FRAME, "rounded-md"]
            : "rounded-md ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          swatchClassName
        )}
        {...props}
      />
      {showValue && (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {current.toUpperCase()}
        </span>
      )}
      {eyedropper && canPick && (
        <button
          type="button"
          data-slot="glow-color-eyedropper"
          onClick={pick}
          disabled={disabled}
          aria-label={eyedropperLabel}
          title={eyedropperLabel}
          className={cn(
            "inline-grid shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground",
            "transition-[color,background-color] duration-200 ease-[var(--ease-duck)]",
            "hover:bg-secondary hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
            "disabled:pointer-events-none disabled:opacity-50",
            size === "sm" ? "size-7" : "size-8"
          )}
        >
          <Pipette className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
        </button>
      )}
    </div>
  );
}

export { GlowColor, normalizeHex };
