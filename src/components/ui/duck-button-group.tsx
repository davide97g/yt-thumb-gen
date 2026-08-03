"use client";

import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * DuckButtonGroup — shared geometry for a cluster of buttons that *act*. It is
 * the grouping StickerToggleGroup already does, minus the selection: nothing in
 * here has a value, a state or a lime fill, because zoom in is not a choice
 * among zoom levels. What it replaces is the local class string every app with
 * a canvas grows — a ZOOM_BUTTON constant carrying size, radius corners and
 * border trim, pasted onto three buttons and re-derived from scratch on the
 * next screen.
 *
 * The group styles its children through `[&>*]` selectors rather than by
 * targeting a data-slot, for two reasons. It works the same for a plain
 * <button>, an <a> or a QuackButton, so the group never has to know what it was
 * handed; and it wins. `.group > *` and the child's own `.rounded-lg` tie on
 * specificity — `*` contributes nothing — but Tailwind emits arbitrary-variant
 * utilities after plain ones, so the group's rule is the one that lands. No
 * !important, and no cooperation from the child.
 *
 * `joined` is on by default. Unjoined, this is a flex row with a gap, and
 * nobody installs a component for that; the seam is the reason to be here.
 *
 * The seam is an overlap, not a trim. Children after the first pull back by
 * exactly --sticker-border, so two 3px edges land on each other and read as one
 * divider. The obvious alternative — `border-left: 0` on everything past the
 * first — shifts their content by 3px and destroys any child that draws its
 * edge as a background instead of a border: holo-border is a border-box
 * gradient, and taking the width away takes the gradient with it. The pull is
 * the token rather than a literal 3px, so a theme that thins the sticker edge —
 * duck-noir takes it to 1px — gets a 1px seam without being asked.
 *
 * Focus is the part that goes wrong, and it is worth saying out loud because
 * the bug is invisible until someone tabs. Later siblings paint over earlier
 * ones, so the ring on a middle child is half-covered by its neighbour the
 * moment the boxes overlap. The fix is a z-index while hovered or focused, not
 * a thinner ring — and nothing here sets overflow: hidden, which would clip the
 * ring outright.
 *
 * Roles. Buttons that act are a `role="group"` with an accessible name, and
 * that is the default: three Tabs for three buttons is what a reader expects of
 * three buttons. `toolbar` swaps in `role="toolbar"` plus the one-tab-stop
 * roving tabindex — reach for it once the cluster is the screen's controls
 * rather than part of a form: an icon-only canvas cluster, or anything past
 * about four. The keyboard handling is deliberately the same shape as
 * StickerToggleGroup's rather than extracted into a shared hook, because
 * registry items are copied one file at a time and six lines are not worth a
 * second install. It differs in one way: this one claims only the axis it
 * advertises, so ArrowDown in a horizontal toolbar still scrolls the page.
 *
 * The accessible name is required by the types, not merely documented. A group
 * or a toolbar with no name is announced as an unnamed container and three icon
 * buttons cannot say between them that they are the zoom controls.
 */

const duckButtonGroupVariants = cva("inline-flex w-fit items-stretch", {
  variants: {
    orientation: {
      horizontal: "flex-row",
      vertical: "flex-col",
    },
    joined: {
      true: [
        // The group's own radius paints nothing — it has neither background nor
        // border. It is the value the end children inherit, so one rounded-*
        // class here (twMerge lets className win) resizes the whole cluster's
        // corners.
        "rounded-lg",
        "[&>*]:relative [&>*]:rounded-none",
        // Raise the child that is being pointed at or focused above the
        // neighbour overlapping it. Focus outranks hover: a hover ring is
        // decoration, a focus ring is the only thing telling a keyboard user
        // where they are.
        "[&>*:hover]:z-10 [&>*:focus-visible]:z-20 [&>*:focus-within]:z-20",
        // Suppress the hover lift only. A 2px rise on a middle segment tears
        // the seam open for as long as the pointer rests there, while the press
        // squash is a 75ms transient that reads as the segment being pushed in
        // — that one stays.
        "[&>*:hover]:[--lift:0px]",
      ],
      false: "gap-2",
    },
  },
  compoundVariants: [
    {
      orientation: "horizontal",
      joined: true,
      class: [
        "[&>*:not(:first-child)]:ml-[calc(var(--sticker-border)*-1)]",
        "[&>*:first-child]:rounded-l-[inherit] [&>*:last-child]:rounded-r-[inherit]",
      ],
    },
    {
      orientation: "vertical",
      joined: true,
      class: [
        "[&>*:not(:first-child)]:mt-[calc(var(--sticker-border)*-1)]",
        "[&>*:first-child]:rounded-t-[inherit] [&>*:last-child]:rounded-b-[inherit]",
      ],
    },
  ],
  defaultVariants: { orientation: "horizontal", joined: true },
});

/**
 * What counts as an item for the roving tabindex. Disabled controls are out,
 * exactly as they are in StickerToggleGroup, so arrows skip them rather than
 * landing on a dead stop. Descendants count, not just children: a toolbar of
 * joined groups is the ARIA-correct shape for a bar of clusters, and its
 * buttons sit one level down.
 */
const TOOLBAR_ITEMS = [
  "button:not([disabled])",
  "a[href]",
  '[role="button"]:not([aria-disabled="true"])',
].join(",");

function toolbarItems(host: HTMLElement) {
  return Array.from(host.querySelectorAll<HTMLElement>(TOOLBAR_ITEMS));
}

interface DuckButtonGroupOwnProps extends React.ComponentProps<"div"> {
  orientation?: "horizontal" | "vertical";
  /** Collapse the shared edges so the cluster reads as one control. */
  joined?: boolean;
  /** One tab stop for the whole cluster, arrows inside it. */
  toolbar?: boolean;
}

/** One of the two has to be there; see the note on naming above. */
type AccessibleName =
  | { "aria-label": string }
  | { "aria-labelledby": string };

export type DuckButtonGroupProps = DuckButtonGroupOwnProps & AccessibleName;

function DuckButtonGroup({
  className,
  orientation = "horizontal",
  joined = true,
  toolbar = false,
  children,
  onKeyDown,
  onFocusCapture,
  ...props
}: DuckButtonGroupProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(0);

  // The roving tabindex is written to the DOM after every render rather than
  // cloned into the children's props. cloneElement would only reach children
  // whose type happens to forward tabIndex, and would miss anything wrapped in
  // a tooltip, a link or a Slot — and the whole point of this component is that
  // it works with children it knows nothing about. No dependency array: the
  // children are not ours to diff.
  React.useEffect(() => {
    const host = ref.current;
    if (!toolbar || !host) return;
    const items = toolbarItems(host);
    if (items.length === 0) return;
    const stop = Math.min(active, items.length - 1);
    items.forEach((item, index) => {
      item.tabIndex = index === stop ? 0 : -1;
    });
  });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (!toolbar || event.defaultPrevented) return;
    const [back, forward] =
      orientation === "vertical"
        ? ["ArrowUp", "ArrowDown"]
        : ["ArrowLeft", "ArrowRight"];
    if (![back, forward, "Home", "End"].includes(event.key)) return;
    const items = toolbarItems(event.currentTarget);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === forward
            ? (index + 1) % items.length
            : (index - 1 + items.length) % items.length;
    items[next].focus();
    setActive(next);
  };

  // A click or a Tab can move focus without going through the arrow keys, and
  // the tab stop has to follow, or leaving and re-entering the toolbar lands
  // somewhere the user never was.
  const handleFocusCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    onFocusCapture?.(event);
    if (!toolbar) return;
    const index = toolbarItems(event.currentTarget).indexOf(
      event.target as HTMLElement
    );
    if (index >= 0) setActive(index);
  };

  return (
    <div
      ref={ref}
      role={toolbar ? "toolbar" : "group"}
      aria-orientation={toolbar ? orientation : undefined}
      data-slot="duck-button-group"
      data-orientation={orientation}
      data-joined={joined || undefined}
      onKeyDown={handleKeyDown}
      onFocusCapture={handleFocusCapture}
      className={cn(duckButtonGroupVariants({ orientation, joined }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { DuckButtonGroup, duckButtonGroupVariants };
