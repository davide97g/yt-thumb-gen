"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DuckTabs — tabs with an indicator that slides between triggers. Full
 * keyboard support: arrows move, Home and End jump to the ends.
 */

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
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
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
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
    <TabsContext.Provider value={{ value, setValue, baseId }}>
      <div
        data-slot="duck-tabs"
        className={cn("flex flex-col gap-4", className)}
        {...props}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

function DuckTabsList({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { value } = useTabs("DuckTabsList");
  const listRef = React.useRef<HTMLDivElement>(null);
  const [pill, setPill] = React.useState({ left: 0, width: 0, ready: false });

  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (!active) return;
      setPill({
        left: active.offsetLeft,
        width: active.offsetWidth,
        ready: true,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, children]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
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
          : event.key === "ArrowRight"
            ? (index + 1) % triggers.length
            : (index - 1 + triggers.length) % triggers.length;
    triggers[next].focus();
    triggers[next].click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      data-slot="duck-tabs-list"
      onKeyDown={onKeyDown}
      className={cn(
        "sticker relative inline-flex w-fit items-center gap-1 rounded-xl border-border bg-card p-1",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className="absolute top-1 bottom-1 left-0 rounded-lg bg-primary transition-[transform,width] duration-400 ease-[var(--ease-duck)]"
        style={{
          transform: `translateX(${pill.left}px)`,
          width: pill.width,
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
  const { value: active, setValue, baseId } = useTabs("DuckTabsTrigger");
  const selected = active === value;

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
        selected
          ? "text-primary-foreground"
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
  const { value: active, baseId } = useTabs("DuckTabsContent");
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
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { DuckTabs, DuckTabsList, DuckTabsTrigger, DuckTabsContent };
