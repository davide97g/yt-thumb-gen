"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { GlowInput } from "@/components/ui/glow-input";
import { StickerKbd } from "@/components/ui/sticker-kbd";

/**
 * GlowSearch — the field that filters something.
 *
 * A search box is not a text field with a magnifier stuck to it. It owes the
 * user a way out (a clear button), it owes the consumer a rate limit (typing is
 * six keystrokes, not six queries), and it usually owes the page a hint that a
 * palette exists. Three surfaces of a real app each carried a bare GlowInput
 * with no icon, no clear affordance and no shortcut, and each grew its own
 * setTimeout in a useEffect. This is that, once.
 *
 * The frame is on the wrapper and the field inside it is `frame={false}`, which
 * is precisely what that prop is for: the icon, the field and the clear button
 * live inside one 3px edge and share one focus glow, rather than a bordered
 * input sitting beside two loose buttons.
 *
 * The `⌘K` hint is a hint, not a binding. This component registers no global
 * listener and never will — a field cannot honestly claim a page-wide shortcut.
 * `DuckCommand` is the palette that does own the key; put the hint here and the
 * binding there, and pass the same glyph the platform actually uses.
 *
 * Typing debounces. Enter, Escape and the clear button flush, because all three
 * are decisions rather than keystrokes on the way to one.
 */
export interface GlowSearchProps
  extends Omit<
    React.ComponentProps<"input">,
    "type" | "value" | "defaultValue" | "onSearch" | "children" | "className"
  > {
  /** Controlled query. Pair with onChange, as with any input. */
  value?: string;
  /** Uncontrolled starting query. */
  defaultValue?: string;
  /**
   * The debounced side channel: the query, after the user has stopped typing.
   * onChange still fires on every keystroke — this is the one you hang a fetch
   * or a filter off.
   */
  onSearch?: (value: string) => void;
  /** Milliseconds of quiet before onSearch fires. 0 fires on every keystroke. */
  debounce?: number;
  /** Keycap hint drawn while the field is empty — "⌘K", "/" — not a binding. */
  kbd?: React.ReactNode;
  /** Accessible name of the clear button. */
  clearLabel?: string;
  /** Styles the frame. Anything else you pass lands on the field. */
  className?: string;
  /** Styles the field inside the frame, for the rare case the type has to move. */
  inputClassName?: string;
}

function GlowSearch({
  className,
  inputClassName,
  value,
  defaultValue = "",
  onChange,
  onKeyDown,
  onSearch,
  debounce = 250,
  kbd,
  clearLabel = "Clear search",
  placeholder = "Search",
  disabled,
  ref,
  ...props
}: GlowSearchProps) {
  const controlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue);
  const current = controlled ? value : internal;

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // The debounce reads the callback out of a ref so a consumer passing an inline
  // arrow does not have to memoise it to avoid restarting the timer.
  const latest = React.useRef(onSearch);
  React.useEffect(() => {
    latest.current = onSearch;
  });

  const cancel = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // A pending query outliving the component is a setState on nothing, or worse a
  // fetch nobody is waiting for.
  React.useEffect(() => cancel, [cancel]);

  const flush = React.useCallback(
    (next: string) => {
      cancel();
      latest.current?.(next);
    },
    [cancel]
  );

  const schedule = React.useCallback(
    (next: string) => {
      cancel();
      if (!latest.current) return;
      if (debounce <= 0) {
        latest.current(next);
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        latest.current?.(next);
      }, debounce);
    },
    [cancel, debounce]
  );

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!controlled) setInternal(event.target.value);
      onChange?.(event);
      schedule(event.target.value);
    },
    [controlled, onChange, schedule]
  );

  const clear = React.useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    // Everything — the internal value, onChange, the debounce — hangs off the
    // field's own change event, so the honest way to clear is to make the field
    // genuinely change. React swaps the element's `value` setter for a tracking
    // one, so `input.value = ""` would update its cached value and React would
    // then discard the event as a no-op; going through the prototype descriptor
    // leaves that cache stale, which is what React reads as a real edit. This is
    // also why a controlled consumer needs nothing beyond the onChange it has.
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setValue?.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush("");
    // The button the pointer just hit is about to unmount. Without this, focus
    // lands on <body> and a keyboard user starts their next query from the top
    // of the page.
    input.focus();
  }, [flush]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;

      // Someone who presses Enter has finished typing, so the pending query goes
      // now. It fires even when the timer already ran: Enter means "search",
      // and a second identical query is cheaper than a field that ignores it.
      if (event.key === "Enter") flush(event.currentTarget.value);

      // Escape clears — but only when there is something to clear. An empty
      // field must let the key through to whatever dialog or palette is above,
      // or the search box inside it becomes a trap.
      if (event.key === "Escape" && event.currentTarget.value !== "") {
        event.preventDefault();
        event.stopPropagation();
        clear();
      }
    },
    [clear, flush, onKeyDown]
  );

  const named =
    props["aria-label"] !== undefined ||
    props["aria-labelledby"] !== undefined ||
    props.id !== undefined;

  return (
    <div
      data-slot="glow-search"
      className={cn(
        // The frame GlowInput would have drawn, moved out one level so the icon
        // and the buttons sit inside the edge and share the glow.
        "sticker flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border-input px-3",
        "transition-[border-color,box-shadow] duration-200 ease-[var(--ease-duck)]",
        "focus-within:border-ring focus-within:duck-glow-primary",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
        className
      )}
    >
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <GlowInput
        frame={false}
        // type="search" for the implicit searchbox role and the search return
        // key on mobile keyboards. It also brings a UA cancel button in WebKit
        // and Blink, which would sit next to ours and look nothing like it, so
        // that one goes.
        type="search"
        enterKeyHint="search"
        // An unnamed search box is the commonest accessibility bug on the web.
        // If nothing else names the field, the placeholder does.
        aria-label={named ? undefined : placeholder}
        placeholder={placeholder}
        disabled={disabled}
        {...props}
        ref={(node) => {
          inputRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        value={controlled ? value : undefined}
        defaultValue={controlled ? undefined : defaultValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={cn(
          "h-full flex-1 [&::-webkit-search-cancel-button]:hidden",
          // The frame above already dims for disabled. Letting the field dim as
          // well multiplies the two and the text all but disappears.
          "disabled:opacity-100",
          inputClassName
        )}
      />
      {current !== "" ? (
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          aria-label={clearLabel}
          className={cn(
            "grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground",
            "transition-colors hover:bg-secondary hover:text-foreground",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <X className="size-3.5" />
        </button>
      ) : (
        kbd && (
          // Hidden from assistive tech: the shortcut belongs to something else
          // on the page, and announcing it here would promise a binding this
          // field does not have.
          <StickerKbd aria-hidden className="shrink-0">
            {kbd}
          </StickerKbd>
        )
      )}
    </div>
  );
}

export { GlowSearch };
