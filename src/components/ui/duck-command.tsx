"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { GlowInput } from "@/components/ui/glow-input";
import { StickerKbd } from "@/components/ui/sticker-kbd";
import {
  StickerDialog,
  StickerDialogContent,
  StickerDialogDescription,
  StickerDialogTitle,
} from "@/components/ui/sticker-dialog";

/**
 * DuckCommand — the ⌘K palette, on the primitives already in the box.
 *
 * Three surfaces in this registry advertise a command key and had nothing to
 * open: DuckDashboard's `onSearch` binds Mod+K and then hands the application a
 * callback with no palette behind it. This is the palette. Wire it to that prop
 * and pass `shortcut={false}`, or drop the prop and let this component own the
 * binding — two handlers on the same keystroke is the one mistake here.
 *
 * There is no cmdk. A palette is a filtered listbox and a text field, and this
 * registry is copied into other people's projects, so a dependency has to earn
 * itself against the code it removes — the same call DuckChart makes about
 * recharts. cmdk earns itself when the options are arbitrary composed children,
 * because filtering children means a mount-order registry that watches the DOM
 * to know which rows survived, which headings are now empty and whether "no
 * results" is true. So the options here are data: `items` is the primary and
 * only filtering-aware API, and children are not accepted at all. That is the
 * whole trade — an array instead of 6 kB of registry — and it is the right way
 * round for a palette, whose rows nearly always come from a route table, a
 * schema or a fetch rather than from JSX.
 *
 * The interaction that matters is that the input never loses focus. Arrow keys
 * move `aria-activedescendant` through the rows while the caret stays where the
 * user is typing; the rows are not tab stops and take no focus, so a keystroke
 * is never spent getting back to the field. That is the combobox pattern, and
 * it is why the rows are `role="option"` divs rather than buttons: a button in
 * there would be focusable, and Tab would then crawl the results instead of
 * leaving.
 *
 * Group headings use the `.hud` utility from HudLabel rather than a heading
 * element. Inside a listbox they are labels for a group, not landmarks in a
 * document.
 */

export interface DuckCommandItemData {
  /** What `onSelect` receives. Defaults to the label. */
  value?: string;
  /** Shown, and matched on. */
  label: string;
  /** Second line. Matched on as well. */
  hint?: string;
  /** Matched on but never shown — synonyms, old names, the word the user types. */
  keywords?: string[];
  icon?: React.ReactNode;
  /** Keycaps down the right-hand side: `"⌘K"` or `["⌘", "N"]`. */
  shortcut?: string | string[];
  /** Renders muted, is skipped by the arrow keys, and cannot be run. */
  disabled?: boolean;
  onSelect?: () => void;
}

export interface DuckCommandGroupData {
  /** Omit for a run of rows with no heading. */
  heading?: string;
  items: DuckCommandItemData[];
}

export interface DuckCommandProps
  extends Omit<React.ComponentProps<"div">, "children" | "onSelect" | "title"> {
  /** Groups, bare items, or a mix. Consecutive bare items share one unheaded group. */
  items: (DuckCommandItemData | DuckCommandGroupData)[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Fires after the item's own `onSelect`. */
  onSelect?: (value: string, item: DuckCommandItemData) => void;
  /** Shown instead of everything while the query is empty. */
  recent?: DuckCommandItemData[];
  recentLabel?: string;
  placeholder?: string;
  /** Names the dialog and the listbox. Not drawn — the input is the only label a palette needs. */
  label?: string;
  /** Extra sentence for screen readers, describing the keys. */
  description?: string;
  emptyMessage?: React.ReactNode;
  /**
   * The global binding. `true` is Mod+K; a string is a key spec, either
   * `"mod+<key>"` or a bare `"<key>"`; `false` binds nothing.
   */
  shortcut?: boolean | string;
  /** Replace the match. The query arrives trimmed and lower-cased. */
  filter?: (item: DuckCommandItemData, query: string) => boolean;
  closeOnSelect?: boolean;
  /** A strip under the list, for key hints or a count. */
  footer?: React.ReactNode;
  /** Iridescent ring instead of the die-cut edge. */
  holo?: boolean;
}

/**
 * Substring across everything the item offers, then subsequence across the
 * label alone — "nsg" still finds "New sticker group". Loose enough to forgive
 * a half-remembered name, tight enough that the subsequence pass does not drag
 * in every row that happens to contain the letters in order.
 *
 * Matches are never re-ordered. A palette whose rows rearrange between
 * keystrokes has to be re-read on every keystroke, so this filters in place and
 * leaves ranking to whoever built the array.
 */
function defaultFilter(item: DuckCommandItemData, query: string) {
  const haystack = [item.label, item.hint, ...(item.keywords ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack.includes(query)) return true;

  const label = item.label.toLowerCase();
  let cursor = 0;
  for (const character of label) {
    if (character === query[cursor]) cursor += 1;
    if (cursor === query.length) return true;
  }
  return false;
}

function isGroup(
  entry: DuckCommandItemData | DuckCommandGroupData
): entry is DuckCommandGroupData {
  return "items" in entry;
}

/** Bare items collect into one group rather than one group each. */
function toGroups(entries: (DuckCommandItemData | DuckCommandGroupData)[]) {
  const groups: DuckCommandGroupData[] = [];
  for (const entry of entries) {
    if (isGroup(entry)) {
      groups.push({ heading: entry.heading, items: [...entry.items] });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.heading === undefined) last.items.push(entry);
    else groups.push({ items: [entry] });
  }
  return groups;
}

/**
 * A bare key belongs to whatever field the user is typing in, so `/` must not
 * open the palette from inside a textarea. With the platform modifier there is
 * nothing to be ambiguous about — ⌘K types no character — so that binding is
 * taken even from inside an input.
 */
function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

interface FlatEntry {
  item: DuckCommandItemData;
  value: string;
  id: string;
  /** Position in the flattened result, which is the order the arrow keys walk. */
  index: number;
}

function DuckCommand({
  className,
  items,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onSelect,
  recent,
  recentLabel = "Recent",
  placeholder = "Type a command or search…",
  label = "Command palette",
  description,
  emptyMessage = "Nothing matches that.",
  shortcut = true,
  filter,
  closeOnSelect = true,
  footer,
  holo = false,
  ...props
}: DuckCommandProps) {
  const baseId = React.useId();
  const listId = `${baseId}-list`;
  const listRef = React.useRef<HTMLDivElement>(null);

  const [selfOpen, setSelfOpen] = React.useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : selfOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!controlled) setSelfOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange]
  );

  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const normalised = query.trim().toLowerCase();

  const { groups, flat } = React.useMemo(() => {
    const source =
      normalised === "" && recent
        ? [{ heading: recentLabel, items: recent }]
        : toGroups(items);
    const match = filter ?? defaultFilter;

    const flatEntries: FlatEntry[] = [];
    const renderGroups: { heading?: string; entries: FlatEntry[] }[] = [];

    for (const group of source) {
      const entries: FlatEntry[] = [];
      for (const item of group.items) {
        if (normalised !== "" && !match(item, normalised)) continue;
        const entry = {
          item,
          value: item.value ?? item.label,
          id: `${baseId}-o${flatEntries.length}`,
          index: flatEntries.length,
        };
        flatEntries.push(entry);
        entries.push(entry);
      }
      if (entries.length > 0) {
        renderGroups.push({ heading: group.heading, entries });
      }
    }
    return { groups: renderGroups, flat: flatEntries };
  }, [items, recent, recentLabel, normalised, filter, baseId]);

  // Clamped here rather than corrected in an effect, so a list that shrinks
  // under an async refresh never renders one frame with nothing active — and
  // never rests on a disabled row, which the first match easily can be.
  const clamped = flat[activeIndex] ? activeIndex : 0;
  const firstEnabled = flat.findIndex((entry) => !entry.item.disabled);
  const current =
    flat[clamped]?.item.disabled && firstEnabled !== -1 ? firstEnabled : clamped;
  const active = flat[current];

  const openRef = React.useRef(open);
  openRef.current = open;

  React.useEffect(() => {
    if (shortcut === false) return;
    const spec = shortcut === true ? "mod+k" : shortcut;
    const needsMod = spec.startsWith("mod+");
    const key = (needsMod ? spec.slice(4) : spec).toLowerCase();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== key || event.altKey) return;
      if (needsMod !== (event.metaKey || event.ctrlKey)) return;
      if (!needsMod && isEditable(event.target)) return;
      event.preventDefault();
      // Read through a ref so the binding registers once instead of on every
      // open, and so the same keystroke closes what it opened.
      setOpen(!openRef.current);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcut, setOpen]);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-slot="duck-command-item"][data-active]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, current, normalised]);

  /** Next enabled row in `delta`'s direction, wrapping. */
  const step = (from: number, delta: number) => {
    const count = flat.length;
    if (count === 0) return 0;
    let index = from;
    for (let attempt = 0; attempt < count; attempt += 1) {
      index = (index + delta + count) % count;
      if (!flat[index].item.disabled) return index;
    }
    return from;
  };

  const run = (index: number) => {
    const entry = flat[index];
    if (!entry || entry.item.disabled) return;
    entry.item.onSelect?.();
    onSelect?.(entry.value, entry.item);
    if (closeOnSelect) setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // A CJK candidate window uses the same keys. Escape is left alone in every
    // case: closing the dialog is Radix's job and intercepting it here would
    // take the animation with it.
    if (event.nativeEvent.isComposing) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex(step(current, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex(step(current, -1));
        break;
      // Home and End would move the caret in a plain text field. A query is a
      // few characters long and the list is the point, so the list gets them.
      case "Home":
        event.preventDefault();
        setActiveIndex(step(-1, 1));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(step(flat.length, -1));
        break;
      case "Enter":
        event.preventDefault();
        run(current);
        break;
      default:
        break;
    }
  };

  // A keyboard move scrolls the list under a stationary cursor, and the row
  // sliding beneath it fires enter and over events that would drag the active
  // item back down. Real pointer movement changes the coordinates; scrolling
  // does not, so the pointer only wins when it has actually moved.
  const lastPointer = React.useRef({ x: -1, y: -1 });
  const handlePointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
    index: number
  ) => {
    if (
      event.clientX === lastPointer.current.x &&
      event.clientY === lastPointer.current.y
    ) {
      return;
    }
    lastPointer.current = { x: event.clientX, y: event.clientY };
    setActiveIndex(index);
  };

  return (
    <StickerDialog open={open} onOpenChange={setOpen}>
      <StickerDialogContent
        hideClose
        holo={holo}
        data-slot="duck-command"
        // Vertically centred rather than sitting high, because duck-dialog-in
        // carries the centring translate through every frame: moving `top`
        // without rewriting those keyframes throws the panel across the
        // viewport on arrival. Motion is otherwise the theme's — the global
        // reduced-motion rule collapses the arrival to nothing, so the palette
        // appears in place rather than freezing halfway.
        className={cn("max-w-xl gap-0 overflow-hidden p-0", className)}
        {...props}
      >
        <StickerDialogTitle className="sr-only">{label}</StickerDialogTitle>
        <StickerDialogDescription className="sr-only">
          {description ??
            "Type to filter. Use the up and down arrows to move through the results and press Enter to run one."}
        </StickerDialogDescription>

        <div
          data-slot="duck-command-input"
          className="flex items-center gap-3 border-b border-border px-4"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <GlowInput
            frame={false}
            role="combobox"
            aria-label={label}
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={active?.id}
            aria-autocomplete="list"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-12"
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          data-slot="duck-command-list"
          className="max-h-[min(24rem,55svh)] overflow-y-auto overscroll-contain p-2"
        >
          {groups.map((group, index) => (
            <DuckCommandGroup key={index} heading={group.heading}>
              {group.entries.map((entry) => (
                <DuckCommandItem
                  key={entry.id}
                  id={entry.id}
                  active={entry.index === current}
                  disabled={entry.item.disabled}
                  icon={entry.item.icon}
                  label={entry.item.label}
                  hint={entry.item.hint}
                  shortcut={entry.item.shortcut}
                  // Keeps the caret in the field: without this, mousedown on a
                  // non-focusable row blurs the input and the combobox loses
                  // the thread of what is active.
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerMove={(event) => handlePointerMove(event, entry.index)}
                  onClick={() => run(entry.index)}
                />
              ))}
            </DuckCommandGroup>
          ))}
        </div>

        {flat.length === 0 && <DuckCommandEmpty>{emptyMessage}</DuckCommandEmpty>}

        {footer && (
          <div
            data-slot="duck-command-footer"
            className="border-t border-border px-4 py-2.5"
          >
            {footer}
          </div>
        )}
      </StickerDialogContent>
    </StickerDialog>
  );
}

export interface DuckCommandGroupProps extends React.ComponentProps<"div"> {
  heading?: string;
}

/** A labelled run of rows. The heading is the group's label, not a document heading. */
function DuckCommandGroup({
  className,
  heading,
  children,
  ...props
}: DuckCommandGroupProps) {
  const headingId = React.useId();

  return (
    <div
      role="group"
      aria-labelledby={heading ? headingId : undefined}
      data-slot="duck-command-group"
      className={cn("flex flex-col", className)}
      {...props}
    >
      {heading && (
        <div id={headingId} className="hud hud-sm px-3 pt-3 pb-2">
          {heading}
        </div>
      )}
      {children}
    </div>
  );
}

export interface DuckCommandItemProps
  extends Omit<React.ComponentProps<"div">, "children"> {
  label: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  shortcut?: string | string[];
  /** The activedescendant. One row per palette, and it is not focus. */
  active?: boolean;
  disabled?: boolean;
}

function DuckCommandItem({
  className,
  label,
  hint,
  icon,
  shortcut,
  active = false,
  disabled = false,
  ...props
}: DuckCommandItemProps) {
  return (
    <div
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      data-slot="duck-command-item"
      data-active={active || undefined}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground",
        // No transition on the row colours. A held arrow key walks faster than
        // any easing worth having, and the highlight would smear behind it.
        "data-[active]:bg-secondary data-[active]:text-foreground",
        // A lime rail on the live row: the same job the fill does in
        // StickerToggleGroup, at the width a list can afford.
        "data-[active]:shadow-[inset_2px_0_0_var(--primary)]",
        disabled && "pointer-events-none opacity-50",
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">{label}</span>
        {hint && (
          <span className="truncate text-xs text-muted-foreground">{hint}</span>
        )}
      </span>

      {shortcut && (
        // Hidden from the accessible name on purpose: the row is called after
        // the command, and "command sign, K" read after every row is noise. If
        // the keys matter to a screen reader, say so in `hint`.
        <span aria-hidden className="flex shrink-0 items-center gap-1">
          {(Array.isArray(shortcut) ? shortcut : [shortcut]).map((cap) => (
            <StickerKbd key={cap}>{cap}</StickerKbd>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * The no-match state. It sits outside the listbox — a listbox may only contain
 * options and groups — and carries `role="status"`, so arriving at it is
 * announced rather than leaving the user typing into silence.
 */
function DuckCommandEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="status"
      data-slot="duck-command-empty"
      className={cn(
        "px-4 py-10 text-center text-sm text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export { DuckCommand, DuckCommandGroup, DuckCommandItem, DuckCommandEmpty };
