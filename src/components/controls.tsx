import type { CSSProperties, ReactNode } from "react";
import { ChevronRight, Pipette, RotateCcw } from "lucide-react";
import { DuckSlider } from "@/components/ui/duck-slider";
import { DuckSwitch } from "@/components/ui/duck-switch";
import { GlowFieldset } from "@/components/ui/glow-input";
import { HudLabel, hudLabelVariants } from "@/components/ui/hud-label";
import { QuackButton, quackButtonVariants } from "@/components/ui/quack-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StickerToggleGroup, StickerToggleGroupItem } from "@/components/ui/sticker-toggle-group";
import { StickerTooltip } from "@/components/ui/sticker-tooltip";
import { cn } from "@/lib/utils";

// Native screen eyedropper (Chromium): its own magnified zoom-preview follows the cursor, click to pick.
declare global {
  interface Window {
    EyeDropper?: new () => { open: (opts?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }> };
  }
}

/** A file picker wearing a QuackButton (label wrapping a hidden input). `asChild`
    exists for exactly this: the control is a `<label>`, not a `<button>`, and the
    duck rule is to compose the component rather than reimplement its look. */
export function UploadButton({
  label, icon, accept = "image/*,.heic,.heif", className, onFile,
}: { label: ReactNode; icon?: ReactNode; accept?: string; className?: string; onFile: (file: File | undefined) => void }) {
  return (
    <QuackButton asChild variant="outline" size="sm" className={cn("cursor-pointer", className)}>
      <label>
        {icon}
        {label}
        <input
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
      </label>
    </QuackButton>
  );
}

export function Section({
  title, action, children, count, open, onToggle, fill,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  /** Item tally beside the title — tells you what's inside while it's collapsed. */
  count?: number;
  /** Passing `onToggle` makes the head the control that opens and closes the section. */
  open?: boolean;
  onToggle?: () => void;
  /** The open section grows to its content but no further than the rail's leftover
   *  height, scrolling inside itself past that. So a 200-layer stack can never push the
   *  other section heads out of reach. */
  fill?: boolean;
}) {
  const collapsible = !!onToggle;
  const shown = collapsible ? open === true : true;
  const filling = !!fill && shown;
  return (
    // A filling section is the only one allowed to shrink, so its scroller absorbs the
    // squeeze while every other section keeps its full height.
    <section className={cn("flex flex-col gap-2.5", filling ? "min-h-0" : "shrink-0")}>
      {/* rail-head pins this row to the top of a scrolling rail (see styles.css). */}
      <div className="rail-head flex shrink-0 items-center gap-3">
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={shown}
            className="group/head flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn(
                "size-3 shrink-0 text-muted-foreground/70 transition-transform duration-200 ease-[var(--ease-duck)] group-hover/head:text-foreground",
                shown && "rotate-90"
              )}
              aria-hidden
            />
            <SectionTitle title={title} />
            {count !== undefined && (
              <HudLabel size="sm" tracking="tight" className="readout shrink-0 tabular-nums">
                {count}
              </HudLabel>
            )}
            <span className="h-px flex-1 bg-border" aria-hidden />
          </button>
        ) : (
          <>
            <SectionTitle title={title} />
            <span className="h-px flex-1 bg-border" aria-hidden />
          </>
        )}
        {shown && action}
      </div>
      {shown && (
        <div className={cn("flex flex-col gap-2.5", filling && "panel-scroll min-h-0 overflow-y-auto")}>
          {children}
        </div>
      )}
    </section>
  );
}

/** The rail's section heads are HUD readouts — duck's `HudLabel` is that exact
    typographic role (mono, uppercase, wide tracking), so the rail and the duck
    components in it can't drift apart. */
function SectionTitle({ title }: { title: string }) {
  return (
    <h3 className={cn(hudLabelVariants({ size: "sm", tracking: "tight" }), "shrink-0 font-medium")}>{title}</h3>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground/70">{children}</p>;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Small "reset to default" button — rendered only when the current value differs from its default. */
function ResetButton({ onReset }: { onReset: () => void }) {
  return (
    <StickerTooltip content="Reset to default" delay={400}>
      <QuackButton
        variant="ghost"
        size="icon"
        ripple={false}
        onClick={onReset}
        aria-label="Reset to default"
        className="size-6 rounded-md text-muted-foreground"
      >
        <RotateCcw className="size-3" />
      </QuackButton>
    </StickerTooltip>
  );
}

export function SwitchRow({ label, checked, onChange, defaultValue }: { label: string; checked: boolean; onChange: (v: boolean) => void; defaultValue?: boolean }) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-1.5">
        {defaultValue !== undefined && checked !== defaultValue && <ResetButton onReset={() => onChange(defaultValue)} />}
        <DuckSwitch size="sm" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </div>
    </Row>
  );
}

/** Track resolution for `curve="log"` rows: the slider works in integer positions
 *  0…LOG_TICKS, mapped onto [min, max] geometrically. */
const LOG_TICKS = 1000;

export function SliderRow({
  label, min, max, value, onChange, step = 1, display, defaultValue, curve,
}: {
  label: string; min: number; max: number; value: number; onChange: (v: number) => void;
  step?: number; display?: string; defaultValue?: number;
  // "log": each track pixel is a constant *percentage* change, so a huge max stays usable —
  // fine control around the middle, exponentially bigger/smaller steps at the extremes.
  curve?: "log";
}) {
  const log = curve === "log" && min > 0 && max > min;
  const ratio = Math.log(max / min);
  const quantize = (v: number) => {
    const q = Math.round(v / step) * step;
    return step < 1 ? Math.round(q * 1e6) / 1e6 : q;
  };
  const toPos = (v: number) => Math.round((Math.log(Math.min(max, Math.max(min, v)) / min) / ratio) * LOG_TICKS);
  const fromPos = (p: number) => quantize(Math.min(max, Math.max(min, min * Math.exp((p / LOG_TICKS) * ratio))));
  // The visible number is the mono readout in the row above, so the control keeps
  // `showValue` off — but a screen reader still gets the real value, log rows
  // included, which is what `formatValue` is for.
  const spoken = display ?? String(value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <span className="readout text-[11px] text-foreground/85">{display ?? value}</span>
          {defaultValue !== undefined && value !== defaultValue && <ResetButton onReset={() => onChange(defaultValue)} />}
        </div>
      </div>
      {log ? (
        <DuckSlider
          aria-label={label}
          min={0}
          max={LOG_TICKS}
          step={1}
          value={toPos(value)}
          formatValue={() => spoken}
          onChange={(e) => onChange(fromPos(Number(e.target.value)))}
        />
      ) : (
        <DuckSlider
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          formatValue={() => spoken}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
    </div>
  );
}

async function eyedrop(onChange: (v: string) => void) {
  if (!window.EyeDropper) return;
  try {
    const { sRGBHex } = await new window.EyeDropper().open();
    onChange(sRGBHex);
    navigator.clipboard?.writeText(sRGBHex).catch(() => {}); // best-effort copy
  } catch {
    // user pressed Esc — ignore
  }
}

export function ColorRow({ label, value, onChange, defaultValue }: { label: string; value: string; onChange: (v: string) => void; defaultValue?: string }) {
  const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;
  return (
    <Row label={label}>
      <div className="flex items-center gap-1.5">
        {defaultValue !== undefined && value.toLowerCase() !== defaultValue.toLowerCase() && <ResetButton onReset={() => onChange(defaultValue)} />}
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-10" />
        {hasEyeDropper && (
          <StickerTooltip content="Pick a colour from the screen — copies the hex" delay={400}>
            <button
              type="button"
              onClick={() => eyedrop(onChange)}
              aria-label="Eyedropper"
              className={cn(quackButtonVariants({ variant: "ghost", size: "icon" }), "size-7 rounded-md text-muted-foreground")}
            >
              <Pipette className="size-3.5" />
            </button>
          </StickerTooltip>
        )}
      </div>
    </Row>
  );
}

/** A short, mutually exclusive set of options — three or four words at most — as one
 *  segmented control instead of a menu you have to open. A composite control has no single
 *  element for a `<label for>` to point at, which is why the label is a `GlowFieldset`
 *  legend rather than a `Field`. */
export function ToggleRow<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    // The legend has to read as the same rank as a `Field` label, and GlowFieldset styles
    // it internally — hence the child selector rather than a prop.
    <GlowFieldset legend={label} className="gap-1.5 [&>legend]:text-[13px] [&>legend]:font-normal [&>legend]:text-muted-foreground">
      <StickerToggleGroup
        type="single"
        size="sm"
        value={value}
        onValueChange={(v) => { if (v) onChange(v as T); }}
        className="w-full [&>*]:flex-1"
      >
        {options.map((o) => (
          <StickerToggleGroupItem key={o.value} value={o.value} className="justify-center">
            {o.label}
          </StickerToggleGroupItem>
        ))}
      </StickerToggleGroup>
    </GlowFieldset>
  );
}

export function SelectField<T extends string>({
  label, value, options, onChange, onPreview,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; style?: CSSProperties }[];
  onChange: (v: T) => void;
  // Fired while hovering/keyboard-navigating options (Radix focuses the highlighted item);
  // called with null when the menu closes. Lets a caller live-preview the highlighted value.
  onPreview?: (v: T | null) => void;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(v) => onChange(v as T)} onOpenChange={(open) => { if (!open) onPreview?.(null); }}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} style={o.style} onFocus={onPreview ? () => onPreview(o.value) : undefined}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
