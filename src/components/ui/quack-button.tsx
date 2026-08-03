"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { DuckGlyph } from "@/components/ui/duck-spinner";
import { useHoloPointer } from "@/hooks/use-holo-pointer";

/**
 * QuackButton — a button with a full motion cycle: an idle animation while
 * it waits, magnetic pull as the pointer approaches, a squash on press, and
 * an animated loading / success / error transition.
 *
 * Every transform is composed from CSS variables so hover lift, magnetism
 * and press never fight each other.
 *
 * Label typography comes from the --*-button tokens, not from these classes —
 * see the note on HoloButton.
 */

const quackButtonVariants = cva(
  [
    "group/quack relative inline-flex items-center justify-center gap-2 overflow-hidden",
    "whitespace-nowrap cursor-pointer select-none",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
    "transform-gpu transition-[transform,background-color,box-shadow,color] duration-300 ease-[var(--ease-duck)]",
    "translate-x-[var(--mx,0px)] translate-y-[calc(var(--my,0px)+var(--lift,0px))] scale-[var(--press,1)]",
    "hover:[--lift:-2px] active:[--press:0.96] active:duration-75",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/92 hover:duck-glow-primary",
        holo: "holo-border-animated text-foreground hover:duck-glow",
        outline:
          "sticker border-border bg-transparent text-foreground hover:border-primary hover:text-primary",
        ghost: "text-foreground hover:bg-secondary",
        danger:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        sm: "h-8 rounded-md px-3",
        default: "h-10 rounded-lg px-5",
        lg: "h-12 rounded-xl px-7",
        icon: "size-10 rounded-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  }
);

const idleAnimations = {
  none: "",
  /** Breathes once every five seconds. For a resting primary CTA. */
  breathe: "[animation:duck-idle_5s_ease-in-out_infinite]",
  /** Light passes over the surface. For anything with a filled background. */
  sheen:
    "after:absolute after:inset-0 after:bg-[linear-gradient(105deg,transparent_38%,oklch(1_0_0/0.3)_48%,transparent_58%)] after:bg-[length:250%_100%] after:[animation:duck-sheen_5s_ease-in-out_infinite]",
  /** A ring pushes outward on a loop. For a single, unmissable action. */
  pulse: "",
  /** Bobs like something floating. For playful, low-stakes actions. */
  float: "[animation:duck-float_4s_ease-in-out_infinite]",
} as const;

export type QuackButtonState = "idle" | "loading" | "success" | "error";

export interface QuackButtonProps
  extends Omit<React.ComponentProps<"button">, "children">,
    VariantProps<typeof quackButtonVariants> {
  asChild?: boolean;
  children?: React.ReactNode;
  /** Animation played while the button rests. */
  idle?: keyof typeof idleAnimations;
  /** Pull toward the pointer, in px. 0 turns magnetism off. */
  magnetic?: number;
  /** Water ripple from the exact press point. */
  ripple?: boolean;
  /** Drives the loading / success / error transition. */
  state?: QuackButtonState;
  /** Mark shown while loading. Any image URL; defaults to the duck/ui logo. */
  markSrc?: string;
  /**
   * Anything to render in place of the paddling mark while loading — a lucide
   * spinner, a themed glyph, nothing at all. A theme with no mascot had
   * nowhere to put one of these, and the default mark 404s in a project that
   * never installed duck-spinner's asset. EmptyPond's `art` prop is the same
   * escape hatch.
   */
  loadingIndicator?: React.ReactNode;
  loadingLabel?: string;
  successLabel?: string;
  errorLabel?: string;
}

function QuackButton({
  className,
  variant = "primary",
  size = "default",
  asChild = false,
  children,
  idle = "none",
  magnetic = 0,
  ripple = true,
  state = "idle",
  markSrc,
  loadingIndicator,
  loadingLabel,
  successLabel,
  errorLabel,
  disabled,
  onPointerDown,
  ...props
}: QuackButtonProps) {
  const ref = useHoloPointer<HTMLButtonElement>({
    tilt: 0,
    magnet: magnetic,
    disabled: !magnetic,
  });

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      onPointerDown?.(event);
      if (!ripple || event.defaultPrevented) return;
      const host = event.currentTarget;
      const rect = host.getBoundingClientRect();
      const drop = document.createElement("span");
      const diameter = Math.max(rect.width, rect.height);
      drop.className =
        "pointer-events-none absolute rounded-full bg-current [animation:duck-ripple_0.6s_ease-out_forwards]";
      drop.style.width = drop.style.height = `${diameter}px`;
      drop.style.left = `${event.clientX - rect.left - diameter / 2}px`;
      drop.style.top = `${event.clientY - rect.top - diameter / 2}px`;
      drop.addEventListener("animationend", () => drop.remove(), { once: true });
      host.appendChild(drop);
    },
    [onPointerDown, ripple]
  );

  const busy = state === "loading";
  const label =
    (busy && loadingLabel) ||
    (state === "success" && successLabel) ||
    (state === "error" && errorLabel) ||
    children;

  const Comp = asChild ? Slot : "button";

  const body = (
    <>
      {state !== "idle" && (
        <span
          key={state}
          className="inline-grid size-4 place-items-center [animation:duck-pop_0.4s_var(--ease-squash)]"
        >
          {busy &&
            (loadingIndicator !== undefined ? (
              loadingIndicator
            ) : (
              <DuckGlyph
                src={markSrc}
                // The mark is a photographic logo, not a flat icon: it carries
                // a transparent halo, so it needs scaling up and a hairline
                // shadow to stay readable at 16px on a filled button.
                className="scale-125 drop-shadow-[0_1px_2px_oklch(0_0_0/0.45)] [animation:duck-paddle_0.9s_ease-in-out_infinite]"
              />
            ))}
          {state === "success" && <Check className="size-4" strokeWidth={3} />}
          {state === "error" && <TriangleAlert className="size-4" />}
        </span>
      )}
      {label}
    </>
  );

  return (
    <Comp
      ref={ref}
      data-slot="quack-button"
      data-variant={variant}
      data-size={size}
      data-state={state}
      aria-busy={busy || undefined}
      aria-live={state === "idle" ? undefined : "polite"}
      disabled={asChild ? undefined : disabled || busy}
      onPointerDown={handlePointerDown}
      className={cn(
        quackButtonVariants({ variant, size }),
        state === "idle" && idleAnimations[idle],
        state === "success" && "bg-primary text-primary-foreground",
        state === "error" && "bg-destructive text-destructive-foreground",
        busy && "cursor-progress",
        className
      )}
      {...props}
    >
      {/* Slot counts children with React.Children.count, which does not filter
          falsy ones — a second child throws even when it renders nothing. And
          the pulse ring decorates the button's own box, so it has no meaning
          once Slot is cloning someone else's element. */}
      {asChild ? (
        children
      ) : (
        <>
          {body}
          {idle === "pulse" && state === "idle" && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[inherit] border-2 border-current opacity-0 [animation:duck-ripple_2.4s_ease-out_infinite]"
            />
          )}
        </>
      )}
    </Comp>
  );
}

export { QuackButton, quackButtonVariants };
