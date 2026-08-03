import * as React from "react";

import { cn } from "@/lib/utils";
import { HudLabel } from "@/components/ui/hud-label";

/**
 * HoloSeparator — a hairline that fades in from the edges. With a label it
 * becomes a section break; without one it is a quiet divider.
 */
function HoloSeparator({
  className,
  label,
  orientation = "horizontal",
  holo = false,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label?: string;
  orientation?: "horizontal" | "vertical";
  holo?: boolean;
}) {
  const line = holo
    ? "bg-[image:var(--holo)]"
    : "bg-[linear-gradient(to_right,transparent,var(--border),transparent)]";

  if (orientation === "vertical") {
    return (
      <div
        data-slot="holo-separator"
        role="separator"
        aria-orientation="vertical"
        className={cn(
          "w-px self-stretch",
          holo
            ? "bg-[image:var(--holo)]"
            : "bg-[linear-gradient(to_bottom,transparent,var(--border),transparent)]",
          className
        )}
        {...props}
      />
    );
  }

  if (!label) {
    return (
      <div
        data-slot="holo-separator"
        role="separator"
        className={cn("h-px w-full", line, className)}
        {...props}
      />
    );
  }

  return (
    <div
      data-slot="holo-separator"
      role="separator"
      aria-label={label}
      className={cn("flex w-full items-center gap-4", className)}
      {...props}
    >
      <span className={cn("h-px flex-1", line)} />
      <HudLabel tracking="tight">{label}</HudLabel>
      <span className={cn("h-px flex-1", line)} />
    </div>
  );
}

export { HoloSeparator };
