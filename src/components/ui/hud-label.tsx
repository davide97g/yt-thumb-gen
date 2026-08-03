import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * HudLabel — the instrument-panel label: tiny, mono, uppercase, tracked wide
 * enough that it reads as machine output rather than as prose.
 *
 * This is the smallest piece of chrome in the system and the one that appears
 * most often, so it is a component rather than a habit: HoloSeparator's caption
 * and StickerSheet's margin note each carried their own copy of the same five
 * declarations, and had already drifted apart — 11px/0.18em against
 * 10px/0.2em — for no reason anyone chose.
 *
 * Tracking is the whole effect. `tight` is for labels boxed inside a control,
 * where the extra width would push the layout around; anything standing alone
 * wants the default.
 *
 * The dot follows the label rather than the theme's lime. A panel that reads
 * teal for "live" and lime for "action" wants both dots to agree with the words
 * beside them, and a red one is a state the label already has a colour for — so
 * `bg-current` does the work and `dotTone` is there for the case where the dot
 * disagrees with the text on purpose. Both beat reaching into the child with a
 * `[&>span]` selector, which is application code compensating for a missing
 * prop.
 *
 * The item also installs a plain `.hud` utility (plus `.hud-sm` and
 * `.hud-tight`). Reach for that whenever the label is a property of an element
 * that already exists — a <dt>, a <figcaption>, a table header — because
 * wrapping those in a span to get the typography changes the document for the
 * sake of a font size. Use the component when the label *is* the element.
 *
 * The utility's default colour is declared through `:where(.hud)`, at zero
 * specificity. A registry `css` block lands at the end of the utilities layer,
 * so a normal `.hud { color: ... }` would outrank Tailwind's own `text-primary`
 * and quietly win — `class="hud text-primary"` would render muted with no
 * error anywhere. At zero specificity any text-* utility takes precedence and
 * a bare `.hud` still comes out muted.
 */

const hudLabelVariants = cva(
  "font-mono uppercase leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        muted: "text-muted-foreground",
        foreground: "text-foreground",
        /** The accent read: a live value, a section index, a status. */
        primary: "text-primary",
        /** The cool read, for chrome that is the system talking about itself. */
        accent: "text-accent-foreground",
      },
      size: {
        sm: "text-[10px]",
        default: "text-[11px]",
      },
      tracking: {
        default: "tracking-[0.3em]",
        tight: "tracking-[0.18em]",
      },
    },
    defaultVariants: {
      tone: "muted",
      size: "default",
      tracking: "default",
    },
  }
);

const dotTones = {
  muted: "bg-muted-foreground",
  foreground: "bg-foreground",
  primary: "bg-primary duck-glow-primary",
  accent: "bg-accent-foreground",
  destructive: "bg-destructive",
} as const;

export interface HudLabelProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof hudLabelVariants> {
  /**
   * Draw a status dot before the text, in the label's own colour. Decorative —
   * if the state it stands for matters, keep it in the label's words too.
   */
  dot?: boolean;
  /** Colour the dot against the text, for the failing row in a muted list. */
  dotTone?: keyof typeof dotTones;
  /**
   * Render the child element instead of a span. A section heading in a control
   * rail *is* a HUD label and is also an `<h3>`; without this the choice was a
   * span that lies about the outline or `hudLabelVariants()` pasted onto the
   * heading — and then the two ways of getting a HUD label into a page drift.
   * The `.hud` utility is still the answer when the label is a property of an
   * element you are not otherwise touching.
   */
  asChild?: boolean;
}

function HudLabel({
  className,
  tone = "muted",
  size = "default",
  tracking = "default",
  dot = false,
  dotTone,
  asChild = false,
  children,
  ...props
}: HudLabelProps) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="hud-label"
      data-variant={tone}
      data-size={size}
      className={cn(
        hudLabelVariants({ tone, size, tracking }),
        dot && "inline-flex items-center gap-2",
        className
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden
          className={cn(
            // Square, not round: the rest of the HUD is drawn with straight
            // edges, and a lone circle in it reads as a bullet point.
            "size-1.5 shrink-0",
            dotTone
              ? dotTones[dotTone]
              : // Lime is the only tone that glows. On anything else the halo
                // reads as a second colour rather than as brightness.
                cn("bg-current", tone === "primary" && "duck-glow-primary")
          )}
        />
      )}
      {/* Slot counts children with React.Children.only, so the dot and the
          label together would throw. Slottable marks which one is the consumer's
          element; the dot keeps its place in front of the cloned children. */}
      {asChild ? <Slottable>{children}</Slottable> : children}
    </Comp>
  );
}

export { HudLabel, hudLabelVariants };
