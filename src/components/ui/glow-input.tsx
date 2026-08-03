import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Everything that is the field rather than the frame: the type scale, the
 * caret, the placeholder, the selection colours and the disabled state. A
 * frameless field keeps all of it.
 */
const fieldBase = [
  "w-full min-w-0 bg-transparent text-sm outline-none",
  "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
  "disabled:cursor-not-allowed disabled:opacity-50",
];

/** The sticker edge and the lime focus glow — a field standing on its own. */
const fieldFrame = [
  "sticker rounded-lg border-input",
  "transition-[border-color,box-shadow] duration-200 ease-[var(--ease-duck)]",
  "focus-visible:border-ring focus-visible:duck-glow-primary",
  "aria-invalid:border-destructive aria-invalid:focus-visible:shadow-[0_0_24px_oklch(0.65_0.2_25/0.3)]",
];

/**
 * No frame to redden, so invalid has to show in the text and the caret. An
 * inline field still needs to read as wrong.
 */
const fieldBare = "aria-invalid:text-destructive aria-invalid:caret-destructive";

/**
 * Turning the frame off is a prop rather than a class at the call site because
 * a class at the call site cannot win. `.sticker` is declared in the registry's
 * `@layer utilities` block, which lands after Tailwind's own utilities, so
 * `border-0` loses on order at equal specificity and the 3px edge stays. What
 * actually works is six overrides — border, background, shadow, ring and the
 * two focus-visible variants — repeated per call site, which is what this prop
 * replaces.
 */
export interface GlowFrameProps {
  /**
   * Draw the field as an object in its own right. Turn it off when the
   * surface around it is already the frame — a chat composer, a toolbar search,
   * an inline edit cell — and let that surface carry the focus glow.
   */
  frame?: boolean;
}

/** GlowInput — text input that glows in duck lime on focus. */
function GlowInput({
  className,
  type,
  frame = true,
  ...props
}: React.ComponentProps<"input"> & GlowFrameProps) {
  return (
    <input
      type={type}
      data-slot="glow-input"
      data-frame={frame ? "sticker" : "bare"}
      className={cn(
        fieldBase,
        "h-10",
        // The padding belongs to the frame. Inline, the text has to line up
        // with whatever it sits beside.
        frame ? [fieldFrame, "px-3 py-2"] : fieldBare,
        className
      )}
      {...props}
    />
  );
}

/** GlowTextarea — the same focus treatment for multi-line input. */
function GlowTextarea({
  className,
  frame = true,
  ...props
}: React.ComponentProps<"textarea"> & GlowFrameProps) {
  return (
    <textarea
      data-slot="glow-textarea"
      data-frame={frame ? "sticker" : "bare"}
      className={cn(
        fieldBase,
        "min-h-20 leading-relaxed",
        frame ? [fieldFrame, "px-3 py-2"] : fieldBare,
        className
      )}
      {...props}
    />
  );
}

/**
 * GlowField — label above, control in the middle, helper or error below.
 * Wires up htmlFor, aria-describedby and aria-invalid so the control stays
 * accessible without extra work at the call site.
 */
function GlowField({
  className,
  label,
  helper,
  error,
  required,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: string;
  helper?: string;
  error?: string;
  required?: boolean;
  children: React.ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    required?: boolean;
  }>;
}) {
  const generated = React.useId();
  const controlId = children.props.id ?? generated;
  const messageId = `${controlId}-message`;
  const message = error ?? helper;

  return (
    <div
      data-slot="glow-field"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    >
      <label
        htmlFor={controlId}
        className="text-sm font-medium text-foreground"
      >
        {label}
        {required && (
          <span className="ml-1 text-destructive" aria-hidden>
            *
          </span>
        )}
      </label>
      {React.cloneElement(children, {
        id: controlId,
        required,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": message ? messageId : undefined,
      })}
      {message && (
        <p
          id={messageId}
          role={error ? "alert" : undefined}
          className={cn(
            "text-xs",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * GlowFieldset — GlowField for controls that are plural.
 *
 * A radio group, a slider pair, an OTP strip and a dropzone are composite: they
 * have no single element for a <label htmlFor> to point at, so GlowField cannot
 * host them. A real <fieldset><legend> names the whole group instead, and the
 * helper or error text is wired to the group rather than to one control.
 *
 * Keep the legend short. Screen readers prepend it to every control inside.
 */
function GlowFieldset({
  className,
  legend,
  helper,
  error,
  required,
  children,
  ...props
}: Omit<React.ComponentProps<"fieldset">, "children"> & {
  legend: string;
  helper?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const messageId = `${React.useId()}-message`;
  const message = error ?? helper;

  return (
    <fieldset
      data-slot="glow-fieldset"
      aria-describedby={message ? messageId : undefined}
      aria-invalid={error ? true : undefined}
      aria-required={required || undefined}
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    >
      <legend className="text-sm font-medium text-foreground">
        {legend}
        {required && (
          <span className="ml-1 text-destructive" aria-hidden>
            *
          </span>
        )}
      </legend>
      {children}
      {message && (
        <p
          id={messageId}
          role={error ? "alert" : undefined}
          className={cn(
            "text-xs",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {message}
        </p>
      )}
    </fieldset>
  );
}

export { GlowInput, GlowTextarea, GlowField, GlowFieldset };
