import type { CSSProperties, ReactNode } from "react";
import { Pipette, RotateCcw } from "lucide-react";
import { Slider as SliderBase } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Native screen eyedropper (Chromium): its own magnified zoom-preview follows the cursor, click to pick.
declare global {
  interface Window {
    EyeDropper?: new () => { open: (opts?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }> };
  }
}

/** A file picker styled as a shadcn button (label wrapping a hidden input). */
export function UploadButton({
  label, icon, accept = "image/*,.heic,.heif", className, onFile,
}: { label: ReactNode; icon?: ReactNode; accept?: string; className?: string; onFile: (file: File | undefined) => void }) {
  return (
    <label className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "cursor-pointer", className)}>
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
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-3">
        <h3 className="shrink-0 font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">{title}</h3>
        <span className="h-px flex-1 bg-border" aria-hidden />
        {action}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground/70">{children}</p>;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Small "reset to default" button — rendered only when the current value differs from its default. */
function ResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      title="Ripristina valore predefinito"
      className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "size-6 text-muted-foreground")}
    >
      <RotateCcw className="size-3" />
    </button>
  );
}

export function SwitchRow({ label, checked, onChange, defaultValue }: { label: string; checked: boolean; onChange: (v: boolean) => void; defaultValue?: boolean }) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-1.5">
        {defaultValue !== undefined && checked !== defaultValue && <ResetButton onReset={() => onChange(defaultValue)} />}
        <Switch checked={checked} onCheckedChange={onChange} />
      </div>
    </Row>
  );
}

/** Track resolution for `curve="log"` rows: the Radix slider works in integer positions
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
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs tabular-nums text-foreground/70">{display ?? value}</span>
          {defaultValue !== undefined && value !== defaultValue && <ResetButton onReset={() => onChange(defaultValue)} />}
        </div>
      </div>
      {log ? (
        <SliderBase min={0} max={LOG_TICKS} step={1} value={[toPos(value)]} onValueChange={(v) => onChange(fromPos(v[0]))} />
      ) : (
        <SliderBase min={min} max={max} step={step} value={[value]} onValueChange={(v) => onChange(v[0])} />
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
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-10" />
        {hasEyeDropper && (
          <button
            type="button"
            onClick={() => eyedrop(onChange)}
            title="Contagocce — preleva un colore dallo schermo (copia l'hex)"
            className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
          >
            <Pipette className="size-3.5" />
          </button>
        )}
      </div>
    </Row>
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
        <SelectTrigger>
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
