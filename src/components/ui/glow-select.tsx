"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { STICKER_SURFACE } from "@/components/ui/sticker-popover";
import {
  GLOW_FIELD_BARE,
  GLOW_FIELD_BASE,
  GLOW_FIELD_FRAME,
  type GlowFrameProps,
} from "@/components/ui/glow-input";

/**
 * GlowSelect — the field family's missing member.
 *
 * duck's standing advice is that anything it does not ship should be plain
 * shadcn, because the theme already styles it. A select is where that advice
 * runs out: a stock trigger carries a 1px border against GlowInput's 3px
 * die-cut edge, `--radius-md` against its `rounded-lg`, no lime focus glow, and
 * a menu that is not StickerPopover's material. Sat in the same column as two
 * glow fields — which is where selects live, in a settings panel or a control
 * rail — the mismatch is visible in every screenshot. A control rail in a design
 * tool has a dozen of them.
 *
 * So the trigger wears GlowInput's own class strings, imported rather than
 * copied, and the menu wears StickerPopover's own STICKER_SURFACE. Neither
 * recipe can drift from the component it came from, which was the whole
 * complaint: the local select every project writes drifts the first time
 * glow-input.tsx changes.
 *
 * Radix Select underneath, and it earns the dependency: typeahead, roving
 * highlight, aria-activedescendant, collision-aware positioning, a portal that
 * escapes an overflow-hidden rail, scroll locking, and a hidden native <select>
 * so a real form still submits. A native <select> would be lighter and is what
 * DuckSwitch and DuckSlider do — but the option list of a native select is
 * drawn by the OS and cannot be given the die-cut edge, which is half of what
 * this component exists for.
 *
 * `frame` is the same prop, for the same reason, as on GlowInput: `.sticker`
 * lands late in the utilities layer, so a `border-0` at the call site loses on
 * order. Turn it off for a select that is a row action rather than a field.
 */

const GlowSelectRoot = SelectPrimitive.Root;
const GlowSelectGroup = SelectPrimitive.Group;
const GlowSelectValue = SelectPrimitive.Value;

const triggerSizes = {
  /** The rail size: 32px, beside a slider row or a 28px icon button. */
  sm: "h-8 gap-1.5 text-xs",
  default: "h-10 gap-2",
} as const;

export interface GlowSelectTriggerProps
  extends React.ComponentProps<typeof SelectPrimitive.Trigger>,
    GlowFrameProps {
  size?: keyof typeof triggerSizes;
  /** Hide the chevron. For a trigger that is an icon and nothing else. */
  chevron?: boolean;
}

function GlowSelectTrigger({
  className,
  frame = true,
  size = "default",
  chevron = true,
  children,
  ...props
}: GlowSelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="glow-select-trigger"
      data-frame={frame ? "sticker" : "bare"}
      className={cn(
        GLOW_FIELD_BASE,
        "group/glow-select flex cursor-pointer items-center justify-between whitespace-nowrap",
        // The value is text the user did not type, so it reads as placeholder
        // until they choose — same treatment as an empty input.
        "data-placeholder:text-muted-foreground",
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        triggerSizes[size],
        frame
          ? [
              GLOW_FIELD_FRAME,
              size === "sm" ? "px-2" : "px-3 py-2",
              // A pointer opening the menu gets focus but not focus-visible, so
              // the frame would stay cold while its own menu is up.
              "data-[state=open]:border-ring data-[state=open]:duck-glow-primary",
            ]
          : GLOW_FIELD_BARE,
        className
      )}
      {...props}
    >
      {children}
      {chevron && (
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            aria-hidden
            className="shrink-0 text-muted-foreground transition-transform duration-200 ease-[var(--ease-duck)] group-data-[state=open]/glow-select:rotate-180"
          />
        </SelectPrimitive.Icon>
      )}
    </SelectPrimitive.Trigger>
  );
}

function ScrollButton({
  direction,
}: {
  direction: "up" | "down";
}) {
  const Comp =
    direction === "up"
      ? SelectPrimitive.ScrollUpButton
      : SelectPrimitive.ScrollDownButton;
  const Icon = direction === "up" ? ChevronUp : ChevronDown;
  return (
    <Comp className="flex cursor-default items-center justify-center py-1 text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
    </Comp>
  );
}

export type GlowSelectContentProps = React.ComponentProps<
  typeof SelectPrimitive.Content
>;

function GlowSelectContent({
  className,
  position = "popper",
  sideOffset = 8,
  children,
  ...props
}: GlowSelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="glow-select-content"
        position={position}
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden",
          STICKER_SURFACE,
          // Radix measures both for us. The menu is never wider than the
          // viewport and never shorter than the trigger it belongs to.
          position === "popper" &&
            "max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)]",
          // Each one lands on its resting state, so reduced motion — which cuts
          // the duration to nothing — leaves the menu simply there.
          "data-[state=open]:data-[side=top]:[animation:duck-rise_0.16s_var(--ease-duck)]",
          "data-[state=open]:data-[side=bottom]:[animation:duck-rise_0.16s_var(--ease-duck)]",
          "data-[state=open]:data-[side=left]:[animation:duck-fade-in_0.16s_var(--ease-duck)]",
          "data-[state=open]:data-[side=right]:[animation:duck-fade-in_0.16s_var(--ease-duck)]",
          "data-[state=closed]:[animation:duck-fade-out_0.12s_var(--ease-duck)]",
          className
        )}
        {...props}
      >
        <ScrollButton direction="up" />
        <SelectPrimitive.Viewport className="p-1">
          {children}
        </SelectPrimitive.Viewport>
        <ScrollButton direction="down" />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function GlowSelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="glow-select-item"
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none",
        "transition-colors duration-150 ease-[var(--ease-duck)]",
        // Radix drives one highlight for both pointer and keyboard, so there is
        // no hover state to keep in step with it.
        "data-highlighted:bg-secondary data-highlighted:text-foreground",
        "data-[state=checked]:text-primary",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <Check
          className="size-3.5 [animation:duck-pop_0.3s_var(--ease-squash)]"
          strokeWidth={3}
          aria-hidden
        />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

/** A heading over a run of items. Not selectable, so keep it short. */
function GlowSelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="glow-select-label"
      className={cn(
        "hud px-2 py-1.5 text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

function GlowSelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="glow-select-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export interface GlowSelectProps
  extends React.ComponentProps<typeof SelectPrimitive.Root>,
    GlowFrameProps {
  /** Shown until something is chosen. */
  placeholder?: string;
  size?: keyof typeof triggerSizes;
  chevron?: boolean;
  /** Sits on the trigger — this is the element the layout positions. */
  className?: string;
  /** Sizing for the menu. It matches the trigger's width until told otherwise. */
  contentClassName?: string;
  side?: GlowSelectContentProps["side"];
  align?: GlowSelectContentProps["align"];
  /**
   * GlowField hands these to whatever control it wraps, so they have to reach
   * the trigger rather than the root.
   */
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  children: React.ReactNode;
}

/**
 * The whole thing in one element, for the common case: a trigger, a placeholder
 * and a list of items. Compose the parts when the menu needs groups, separators
 * or a trigger that is not the value.
 */
function GlowSelect({
  placeholder,
  frame = true,
  size = "default",
  chevron = true,
  className,
  contentClassName,
  side,
  align,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
  children,
  ...props
}: GlowSelectProps) {
  return (
    <GlowSelectRoot {...props}>
      <GlowSelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid}
        frame={frame}
        size={size}
        chevron={chevron}
        className={className}
      >
        <GlowSelectValue placeholder={placeholder} />
      </GlowSelectTrigger>
      <GlowSelectContent
        side={side}
        align={align}
        className={contentClassName}
      >
        {children}
      </GlowSelectContent>
    </GlowSelectRoot>
  );
}

export {
  GlowSelect,
  GlowSelectRoot,
  GlowSelectTrigger,
  GlowSelectValue,
  GlowSelectContent,
  GlowSelectItem,
  GlowSelectGroup,
  GlowSelectLabel,
  GlowSelectSeparator,
};
