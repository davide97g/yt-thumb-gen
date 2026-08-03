"use client";

import * as React from "react";
import { Check, Copy, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * CopyButton — copies a string and reports it. The check mark pops in, then
 * the button returns to rest after two seconds.
 *
 * The write can be refused: the Clipboard API is unavailable over plain HTTP and
 * inside some embedded browsers, and a permission prompt can be denied. The
 * button correctly never claimed success in that case, but it also said nothing,
 * so the user got a control that appears to do nothing at all. It now announces
 * `errorLabel` and reports through `onError` — the caller is the only one who
 * knows whether the answer is "select the text and copy it manually" or a toast.
 */
function CopyButton({
  value,
  className,
  label = "Copy",
  copiedLabel = "Copied",
  errorLabel = "Copy failed",
  onCopied,
  onError,
  ...props
}: Omit<React.ComponentProps<"button">, "value"> & {
  value: string;
  label?: string;
  copiedLabel?: string;
  /** Announced when the write is refused. */
  errorLabel?: string;
  onCopied?: (value: string) => void;
  /** The rejection, so the caller can say what the button cannot. */
  onError?: (error: unknown) => void;
}) {
  const [state, setState] = React.useState<"idle" | "copied" | "error">("idle");
  const copied = state === "copied";
  const failed = state === "error";

  React.useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      // Reading the property throws in a sandboxed frame, so the guard has to be
      // inside the try rather than an `if` in front of it.
      await navigator.clipboard.writeText(value);
      setState("copied");
      onCopied?.(value);
    } catch (error) {
      setState("error");
      onError?.(error);
    }
  }

  return (
    <button
      type="button"
      data-slot="copy-button"
      data-state={state}
      onClick={copy}
      aria-label={failed ? errorLabel : copied ? copiedLabel : label}
      className={cn(
        "inline-grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-border/60 bg-card/60 text-muted-foreground",
        "transition-[color,background-color,border-color,transform] duration-200 ease-[var(--ease-duck)]",
        "hover:border-primary/60 hover:text-primary active:scale-95",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        copied && "border-primary/70 text-primary",
        failed && "border-destructive/70 text-destructive hover:border-destructive/70 hover:text-destructive",
        className
      )}
      {...props}
    >
      {copied ? (
        <Check
          className="size-3.5 [animation:duck-pop_0.35s_var(--ease-squash)]"
          strokeWidth={3}
        />
      ) : failed ? (
        <X
          className="size-3.5 [animation:duck-pop_0.35s_var(--ease-squash)]"
          strokeWidth={3}
        />
      ) : (
        <Copy className="size-3.5" />
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : failed ? errorLabel : ""}
      </span>
    </button>
  );
}

export { CopyButton };
