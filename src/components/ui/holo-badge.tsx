import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * HoloBadge — pill for status, counts and short labels.
 *
 * `shape` exists because rounded-full is right for a status pill and wrong for
 * a tag, and 9999px is immune to the radius scale: a square-cornered theme
 * could not get a square badge out of any token, so every tag call site opened
 * with `rounded-none` to undo the component's own base. That is a shape
 * decision, not a theme override.
 *
 * Typography — family, weight, tracking, case, size — comes from the --*-badge
 * tokens through a zero-specificity rule in the theme, for the same reason
 * HoloButton's does. A utility on the call site still wins.
 */
const holoBadgeVariants = cva(
  ["inline-flex w-fit items-center gap-1.5 px-2.5 py-0.5", "whitespace-nowrap [&_svg]:size-3"],
  {
    variants: {
      variant: {
        holo: "holo-border text-foreground",
        primary: "bg-primary text-primary-foreground",
        outline: "sticker border-border text-foreground",
        muted: "bg-muted text-muted-foreground",
        success: "bg-primary/15 text-primary",
        danger: "bg-destructive/15 text-destructive",
      },
      shape: {
        /** Status, counts, live values. */
        pill: "rounded-full",
        /** Taxonomy: a tag follows the radius scale like every other surface. */
        tag: "rounded-md",
      },
    },
    defaultVariants: { variant: "holo", shape: "pill" },
  }
);

function HoloBadge({
  className,
  variant = "holo",
  shape = "pill",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof holoBadgeVariants>) {
  return (
    <span
      data-slot="holo-badge"
      data-variant={variant}
      data-shape={shape}
      className={cn(holoBadgeVariants({ variant, shape }), className)}
      {...props}
    />
  );
}

export { HoloBadge, holoBadgeVariants };
