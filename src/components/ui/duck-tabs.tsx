"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DuckTabs — tabs with an indicator that slides between triggers. Full
 * keyboard support: arrows move, Home and End jump to the ends.
 *
 * `orientation="vertical"` is the section rail every settings dialog wants at
 * ≥640px. It is a real axis change rather than a rotation: the list measures
 * offsetTop and offsetHeight, the arrow keys become Up and Down (which is what
 * aria-orientation promises a screen reader), and the indicator stops being a
 * filled pill behind the label — a 3px bar down the left edge, because a pill
 * wide enough to cover a rail of varying-length labels has to be the width of
 * the longest one, and then it is a block of colour rather than a marker.
 */

type TabsOrientation = "horizontal" | "vertical";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
  orientation: TabsOrientation;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs(component: string) {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error(`${component} must be used inside <DuckTabs>`);
  }
  return context;
}

function DuckTabs({
  className,
  value: controlled,
  defaultValue,
  onValueChange,
  orientation = "horizontal",
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** `vertical` puts the list beside the panel instead of above it. */
  orientation?: TabsOrientation;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? "");
  const value = controlled ?? uncontrolled;
  const baseId = React.useId();

  const setValue = React.useCallback(
    (next: string) => {
      if (controlled === undefined) setUncontrolled(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange]
  );

  return (
    <TabsContext.Provider value={{ value, setValue, baseId, orientation }}>
      <div
        data-slot="duck-tabs"
        data-orientation={orientation}
        className={cn(
          "flex",
          orientation === "vertical" ? "flex-row gap-6" : "flex-col gap-4",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

function DuckTabsList({
  className,
  frame = true,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /**
   * Draw the die-cut edge around the list. Off for a rail that sits inside a
   * panel which is already the frame. Same prop, same reason, as on GlowInput:
   * `.sticker` lands at the end of the utilities layer, so a `border-0` at the
   * call site loses on order. `sticker-none` is the class-level version.
   */
  frame?: boolean;
}) {
  const { value, orientation } = useTabs("DuckTabsList");
  const vertical = orientation === "vertical";
  const listRef = React.useRef<HTMLDivElement>(null);
  const [pill, setPill] = React.useState({ start: 0, size: 0, ready: false });

  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (!active) return;
      setPill({
        start: vertical ? active.offsetTop : active.offsetLeft,
        size: vertical ? active.offsetHeight : active.offsetWidth,
        ready: true,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, children, vertical]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // The axis owns the keys. Left and Right on a vertical rail move nothing,
    // which is what aria-orientation has already told the screen reader.
    const [forwardKey, backKey] = vertical
      ? ["ArrowDown", "ArrowUp"]
      : ["ArrowRight", "ArrowLeft"];
    const keys = [forwardKey, backKey, "Home", "End"];
    if (!keys.includes(event.key)) return;
    const triggers = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]:not([disabled])'
      )
    );
    const index = triggers.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? triggers.length - 1
          : event.key === forwardKey
            ? (index + 1) % triggers.length
            : (index - 1 + triggers.length) % triggers.length;
    triggers[next].focus();
    triggers[next].click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation={orientation}
      data-slot="duck-tabs-list"
      data-orientation={orientation}
      data-frame={frame ? "sticker" : "bare"}
      onKeyDown={onKeyDown}
      className={cn(
        "relative inline-flex w-fit gap-1 rounded-xl bg-card p-1",
        frame ? "sticker border-border" : "sticker-none",
        vertical ? "flex-col items-stretch" : "items-center",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "absolute bg-primary transition-[transform,width,height] duration-400 ease-[var(--ease-duck)]",
          vertical
            ? "top-0 left-1 w-[3px] rounded-full"
            : "top-1 bottom-1 left-0 rounded-lg"
        )}
        style={{
          transform: vertical
            ? `translateY(${pill.start}px)`
            : `translateX(${pill.start}px)`,
          width: vertical ? undefined : pill.size,
          height: vertical ? pill.size : undefined,
          opacity: pill.ready ? 1 : 0,
        }}
      />
      {children}
    </div>
  );
}

function DuckTabsTrigger({
  className,
  value,
  children,
  ...props
}: React.ComponentProps<"button"> & { value: string }) {
  const {
    value: active,
    setValue,
    baseId,
    orientation,
  } = useTabs("DuckTabsTrigger");
  const selected = active === value;
  const vertical = orientation === "vertical";

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-controls={`${baseId}-panel-${value}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-state={selected ? "active" : "inactive"}
      data-slot="duck-tabs-trigger"
      onClick={() => setValue(value)}
      className={cn(
        "relative z-1 cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap",
        "transition-colors duration-200 ease-[var(--ease-duck)]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        // No filled pill on the vertical rail, so the active label carries the
        // accent itself — primary-foreground on the card would be unreadable.
        vertical && "pl-4 text-left",
        selected
          ? vertical
            ? "text-primary"
            : "text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function DuckTabsContent({
  className,
  value,
  children,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  const { value: active, baseId, orientation } = useTabs("DuckTabsContent");
  if (active !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      data-slot="duck-tabs-content"
      className={cn(
        "[animation:duck-rise_0.35s_var(--ease-duck)] focus-visible:outline-none",
        // Beside the rail rather than under it, so the panel takes the rest of
        // the row and its own content decides where it wraps.
        orientation === "vertical" && "min-w-0 flex-1",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { DuckTabs, DuckTabsList, DuckTabsTrigger, DuckTabsContent };
