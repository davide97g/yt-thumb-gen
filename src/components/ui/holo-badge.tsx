import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * HoloBadge — pill for status, counts and short labels.
 *
 * `shape` exists because rounded-full is right for a status pill and wrong for
 * a tag, and 9999px is immune to the radius scale: a square-cornered theme
 * could not get a square badge out of any token, so every tag call site opened
 * with `rounded-none` to undo the component's own base. That is a shape
 * decision, not a theme override. `block` is the third of those decisions: a
 * rail-wide status strip is a badge, not a pill, and it was being written as
 * `shape="tag"` plus `w-full justify-center` everywhere it appeared.
 *
 * Typography — family, weight, tracking, case, size — comes from the --*-badge
 * tokens through a zero-specificity rule in the theme, for the same reason
 * HoloButton's does. A utility on the call site still wins.
 */
const holoBadgeVariants = cva(
  ["items-center gap-1.5 px-2.5 py-0.5", "whitespace-nowrap [&_svg]:size-3"],
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
        pill: "inline-flex w-fit rounded-full",
        /** Taxonomy: a tag follows the radius scale like every other surface. */
        tag: "inline-flex w-fit rounded-md",
        /** The rail-wide status strip: full width, centred, its own line. */
        block: "flex w-full justify-center rounded-md",
      },
    },
    defaultVariants: { variant: "holo", shape: "pill" },
  }
);

export interface HoloBadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof holoBadgeVariants> {
  /**
   * Render the child element instead of a span. A badge that is semantically a
   * heading, a `<dd>` or a link has to be that element — otherwise the choice is
   * a span that lies about the document or `holoBadgeVariants()` pasted onto the
   * real one, and then the two ways of drawing a badge drift.
   */
  asChild?: boolean;
}

function HoloBadge({
  className,
  variant = "holo",
  shape = "pill",
  asChild = false,
  ...props
}: HoloBadgeProps) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="holo-badge"
      data-variant={variant}
      data-shape={shape}
      className={cn(holoBadgeVariants({ variant, shape }), className)}
      {...props}
    />
  );
}

export { HoloBadge, holoBadgeVariants };
