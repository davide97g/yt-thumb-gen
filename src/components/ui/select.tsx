// The one control duck/ui does not ship. Rule 7 of the design system applies —
// duck/ui is additive, so anything it lacks is plain shadcn/ui and the duck theme
// already tokenises it. The trigger deliberately mirrors `glow-input`'s field
// vocabulary (sticker edge, lime focus glow, --ease-duck) and the menu mirrors
// `sticker-popover`, so a select sitting next to a GlowInput reads as one system.
//
// Filed as a gap on duck/ui: docs/GAPS-thumb-studio.md in the duck-ui repo.
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  frame = true,
  chevron = true,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  /**
   * Draw the trigger as a field in its own right. Turn it off where the select is
   * a row action rather than a form control — an icon-sized picker inside a list
   * row. A prop rather than a class at the call site for the same reason
   * `GlowInput` has one: `.sticker` is declared in the theme's `@layer utilities`,
   * which lands after Tailwind's utilities, so a `border-0` at the call site loses
   * on order and the 3px edge stays.
   */
  frame?: boolean;
  /** The affordance only makes sense on a field; a 28px icon trigger has no room. */
  chevron?: boolean;
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-frame={frame ? "sticker" : "bare"}
      className={cn(
        "flex items-center gap-2 text-sm whitespace-nowrap",
        "transition-[border-color,box-shadow,background-color] duration-200 ease-[var(--ease-duck)]",
        "disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
        frame
          ? [
              "sticker h-10 w-full justify-between rounded-lg border-input bg-transparent px-3 py-2",
              "hover:border-primary/60 focus-visible:border-ring focus-visible:duck-glow-primary focus-visible:outline-none",
            ]
          : "justify-center rounded-md bg-transparent hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      {...props}
    >
      {children}
      {chevron && (
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
      )}
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "sticker relative z-50 max-h-96 min-w-32 overflow-hidden rounded-xl border-border bg-popover text-popover-foreground duck-glow",
          position === "popper" && "data-[side=bottom]:translate-y-1",
          className
        )}
        position={position}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn("p-1", position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]")}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none",
        "transition-colors duration-150 ease-[var(--ease-duck)]",
        "focus:bg-secondary focus:text-primary data-[state=checked]:text-primary",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5 text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
