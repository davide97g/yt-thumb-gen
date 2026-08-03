import * as React from "react";

import { cn } from "@/lib/utils";
import { DuckMark } from "@/components/ui/duck-mark";

/**
 * EmptyPond — still water. Nothing has landed here yet, so the ripples are
 * the emptiness rather than decoration on top of it: one duck at rest, one
 * float, two rings holding the space something will eventually fill.
 *
 * This is the one place in the system the mascot is allowed to be large, and
 * the float is the viewport's one idle animation while it is on screen. When a
 * duck is off-domain — a film library, a bank — swap the drawing through `art`
 * and keep the frame, the ripples and the copy hierarchy.
 *
 * An empty screen is an invitation, so give it an action. If there is genuinely
 * nothing to do, say why the screen is empty instead.
 */
export interface EmptyPondProps extends React.ComponentProps<"div"> {
  title: string;
  /** One line on what to do about it. */
  hint?: string;
  /** The way out. A button, a link — whatever the next step actually is. */
  action?: React.ReactNode;
  /**
   * The drawing inside the ripples. Rendered as given, inside a 6rem frame that
   * is already aria-hidden — so a replacement sizes itself (the mascot is 4rem)
   * and opts into the float if it wants it.
   */
  art?: React.ReactNode;
  /** Drop the mascot and the ripples, for empty states inside small panels. */
  compact?: boolean;
}

function EmptyPond({
  className,
  title,
  hint,
  action,
  art = (
    <DuckMark
      pose="swim"
      className="relative size-16 [animation:duck-float_5s_ease-in-out_infinite]"
    />
  ),
  compact = false,
  ...props
}: EmptyPondProps) {
  return (
    <div
      data-slot="empty-pond"
      className={cn(
        "flex flex-col items-center justify-center gap-4 px-6 text-center",
        compact ? "py-8" : "py-16",
        className
      )}
      {...props}
    >
      {!compact && (
        <span aria-hidden className="relative grid size-24 place-items-center">
          <span className="absolute size-20 rounded-full border-2 border-primary/25 [animation:duck-ripple_3.6s_ease-out_infinite]" />
          <span className="absolute size-20 rounded-full border-2 border-primary/25 [animation:duck-ripple_3.6s_ease-out_1.8s_infinite]" />
          {art}
        </span>
      )}

      <div className="flex max-w-sm flex-col gap-1.5">
        <p className="font-display text-base font-bold tracking-tight">{title}</p>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>

      {action}
    </div>
  );
}

export { EmptyPond };
