"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * StickerToggleGroup — one strip of vinyl kiss-cut into panels. The sticker
 * border belongs to the set, not to any panel, so the control reads as a single
 * object and the lime fill is the only thing that ever moves inside it. Panels
 * that are not chosen carry no fill at all: on a toolbar of four, four filled
 * boxes would say nothing.
 *
 * The role follows the mode, because the two modes are different widgets.
 * `type="multiple"` is a set of independent on/off buttons, so each one is a
 * button with aria-pressed inside a toolbar. `type="single"` is a choice among
 * options — which is what a radio group is — so the panels are radios and a
 * screen reader announces "Newest, radio button, 2 of 4". Four aria-pressed
 * buttons would say "pressed" and never say how many options there were.
 *
 * Both modes rove: exactly one panel sits in the tab order and arrows move
 * inside the set, so Tab leaves rather than crawls. Single select moves the
 * selection with the focus, which is the radio contract; multiple select moves
 * focus only and Space commits.
 */

const itemSizes = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  default: "h-9 gap-2 px-3.5 text-sm",
} as const;

interface ToggleGroupContextValue {
  type: "single" | "multiple";
  size: keyof typeof itemSizes;
  disabled: boolean;
  isSelected: (value: string) => boolean;
  isTabStop: (value: string, disabled: boolean) => boolean;
  onFocusItem: (value: string) => void;
  toggle: (value: string) => void;
}

const ToggleGroupContext = React.createContext<ToggleGroupContextValue | null>(
  null
);

function useToggleGroup(component: string) {
  const context = React.useContext(ToggleGroupContext);
  if (!context) {
    throw new Error(`${component} must be used inside <StickerToggleGroup>`);
  }
  return context;
}

/** Both modes run on an array internally; only the public shape differs. */
function toValues(value?: string | string[]) {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return value === "" ? [] : [value];
}

interface StickerToggleGroupBaseProps
  extends Omit<React.ComponentProps<"div">, "defaultValue" | "onChange"> {
  size?: keyof typeof itemSizes;
  /** Disables every panel. Items can also disable themselves. */
  disabled?: boolean;
}

interface StickerToggleGroupSingleProps extends StickerToggleGroupBaseProps {
  type?: "single";
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

interface StickerToggleGroupMultipleProps extends StickerToggleGroupBaseProps {
  type: "multiple";
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
}

type StickerToggleGroupProps =
  | StickerToggleGroupSingleProps
  | StickerToggleGroupMultipleProps;

function StickerToggleGroup({
  className,
  type = "single",
  size = "default",
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  children,
  onKeyDown,
  ...props
}: StickerToggleGroupProps) {
  const [uncontrolled, setUncontrolled] = React.useState(() =>
    toValues(defaultValue)
  );
  const [focused, setFocused] = React.useState<string | null>(null);
  const controlled = value !== undefined;
  const selected = controlled ? toValues(value) : uncontrolled;

  // Scratch space for the tab stop, reset on every group render: the group
  // never learns the panel order any other way, so the first enabled panel
  // claims the stop as it renders.
  const claimed = React.useRef<string | null>(null);
  claimed.current = null;

  const emit = (next: string[]) => {
    // The callback is one shape per mode, so the cast lands here instead of in
    // the props, where it would cost the consumer their inference.
    if (type === "multiple") {
      (onValueChange as ((value: string[]) => void) | undefined)?.(next);
    } else {
      (onValueChange as ((value: string) => void) | undefined)?.(next[0] ?? "");
    }
  };

  const toggle = (item: string) => {
    const next =
      type === "multiple"
        ? selected.includes(item)
          ? selected.filter((current) => current !== item)
          : [...selected, item]
        : // Single select never empties itself. A sort control always has an
          // answer, and radios cannot be unchecked by clicking either.
          [item];
    if (!controlled) setUncontrolled(next);
    emit(next);
  };

  const isTabStop = (item: string, itemDisabled: boolean) => {
    if (itemDisabled || disabled) return false;
    // Radio semantics: Tab lands on the checked option, wherever it sits.
    if (type === "single" && selected.length > 0) return selected[0] === item;
    if (focused !== null) return focused === item;
    if (claimed.current === null) claimed.current = item;
    return claimed.current === item;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    const keys = [
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
      "Home",
      "End",
    ];
    if (event.defaultPrevented || !keys.includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[data-slot="sticker-toggle-group-item"]:not([disabled])'
      )
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : forward
            ? (index + 1) % items.length
            : (index - 1 + items.length) % items.length;
    items[next].focus();
    if (type === "single") items[next].click();
  };

  return (
    <ToggleGroupContext.Provider
      value={{
        type,
        size,
        disabled,
        isSelected: (item) => selected.includes(item),
        isTabStop,
        onFocusItem: setFocused,
        toggle,
      }}
    >
      <div
        role={type === "single" ? "radiogroup" : "toolbar"}
        aria-orientation="horizontal"
        aria-disabled={disabled || undefined}
        data-slot="sticker-toggle-group"
        onKeyDown={handleKeyDown}
        className={cn(
          "sticker inline-flex w-fit items-center gap-1 rounded-xl border-border bg-card p-1",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

interface StickerToggleGroupItemProps extends React.ComponentProps<"button"> {
  value: string;
}

function StickerToggleGroupItem({
  className,
  value,
  disabled,
  children,
  onClick,
  onFocus,
  ...props
}: StickerToggleGroupItemProps) {
  const group = useToggleGroup("StickerToggleGroupItem");
  const single = group.type === "single";
  const selected = group.isSelected(value);
  const isDisabled = Boolean(disabled || group.disabled);

  return (
    <button
      type="button"
      role={single ? "radio" : undefined}
      aria-checked={single ? selected : undefined}
      aria-pressed={single ? undefined : selected}
      disabled={isDisabled}
      tabIndex={group.isTabStop(value, isDisabled) ? 0 : -1}
      data-state={selected ? "on" : "off"}
      data-slot="sticker-toggle-group-item"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) group.toggle(value);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        group.onFocusItem(value);
      }}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-lg font-semibold whitespace-nowrap select-none",
        "transform-gpu scale-[var(--press,1)] transition-[transform,background-color,box-shadow,color] duration-200 ease-[var(--ease-duck)]",
        "active:[--press:0.94] active:duration-75",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        selected
          ? "bg-primary text-primary-foreground duck-glow-primary"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        itemSizes[group.size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export { StickerToggleGroup, StickerToggleGroupItem };
