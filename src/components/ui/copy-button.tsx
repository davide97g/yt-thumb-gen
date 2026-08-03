"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * CopyButton — copies a string and reports it. The check mark pops in, then
 * the button returns to rest after two seconds.
 */
function CopyButton({
  value,
  className,
  label = "Copy",
  copiedLabel = "Copied",
  onCopied,
  ...props
}: Omit<React.ComponentProps<"button">, "value"> & {
  value: string;
  label?: string;
  copiedLabel?: string;
  onCopied?: (value: string) => void;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.(value);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      data-slot="copy-button"
      onClick={copy}
      aria-label={copied ? copiedLabel : label}
      className={cn(
        "inline-grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-border/60 bg-card/60 text-muted-foreground",
        "transition-[color,background-color,border-color,transform] duration-200 ease-[var(--ease-duck)]",
        "hover:border-primary/60 hover:text-primary active:scale-95",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        copied && "border-primary/70 text-primary",
        className
      )}
      {...props}
    >
      {copied ? (
        <Check
          className="size-3.5 [animation:duck-pop_0.35s_var(--ease-squash)]"
          strokeWidth={3}
        />
      ) : (
        <Copy className="size-3.5" />
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </button>
  );
}

export { CopyButton };
