import { useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import { Camera, ChevronUp, ImagePlus, Minus, Pencil, Smile, Square, Type, Upload } from "lucide-react";
import { StickerKbd } from "./ui/sticker-kbd";
import { StickerPopoverContent, StickerPopoverRoot, StickerPopoverTrigger } from "./ui/sticker-popover";
import {
  StickerTooltipContent,
  StickerTooltipProvider,
  StickerTooltipRoot,
  StickerTooltipTrigger,
} from "./ui/sticker-tooltip";
import { cn } from "@/lib/utils";
import {
  newEmojiLayer,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
  type Action,
  type Layer,
} from "../state";
import { loadImageFile } from "../lib/loadImageFile";
import { WebcamCapture } from "./WebcamCapture";

const MAX_UPLOAD = 8 * 1024 * 1024;

/** A dock entry: a tool with its shortcut, or a visual separator. `shortcut` is the
    bare letter the key handler listens for; `hint` is only what the tip prints, so
    a tool driven by a chord (image = ⌘O) can still show it. `cap`/`capMeta` are what
    the tip's keycap depresses on — the printed hint isn't a `KeyboardEvent.key`. */
type DockItem =
  | { sep: true }
  | {
      sep?: false;
      id: string;
      label: string;
      hint: string;
      shortcut?: string;
      cap?: string;
      capMeta?: boolean;
      icon: ReactNode;
      run: () => void;
      toggle?: boolean;
      /** Renders a chevron next to the button opening this list of extra sources. */
      menu?: { label: string; icon: ReactNode; run: () => void }[];
    };

/** Floating, bottom-centred creation dock (Excalidraw-style): every "add a layer"
    action lives here so the side panels stay focused on editing what exists.

    Each tool carries its shortcut in its hover tip, so the dock teaches its own
    keyboard map. Image is the one chord (⌘O, like any "open file"); the webcam is a
    second source behind its chevron rather than a top-level tool. */
export function Toolbar({ dispatch, onError, drawMode, setDrawMode, enabled = true }: { dispatch: Dispatch<Action>; onError: (msg: string) => void; drawMode: boolean; setDrawMode: (v: boolean) => void; enabled?: boolean }) {
  const [showCam, setShowCam] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** Id of the tool that just fired — lights its button for a beat so a keyboard
      trigger is visible even though the pointer never touched the dock. */
  const [fired, setFired] = useState<string | null>(null);
  const firedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const add = (layer: Layer) => dispatch({ type: "addLayer", layer });

  async function addImage(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD) return onError("Image too large (max 8 MB)");
    try {
      onError("");
      add(newImageLayer(await loadImageFile(file)));
    } catch {
      onError("Couldn't read the image.");
    }
  }

  /** One list drives both the buttons and the key handler, so the two can't drift. */
  const tools: DockItem[] = [
    { id: "text", label: "Text", hint: "T", shortcut: "t", icon: <Type />, run: () => add(newTextLayer()) },
    {
      id: "image",
      label: "Image",
      hint: "⌘O",
      cap: "o",
      capMeta: true,
      icon: <ImagePlus />,
      run: () => fileRef.current?.click(),
      menu: [
        { label: "Upload a file", icon: <Upload />, run: () => fileRef.current?.click() },
        { label: "Webcam", icon: <Camera />, run: () => setShowCam(true) },
      ],
    },
    { id: "emoji", label: "Emoji", hint: "E", shortcut: "e", icon: <Smile />, run: () => add(newEmojiLayer()) },
    { id: "draw", label: "Draw", hint: "D", shortcut: "d", icon: <Pencil />, run: () => setDrawMode(!drawMode), toggle: true },
    { sep: true },
    { id: "shape", label: "Shape", hint: "R", shortcut: "r", icon: <Square />, run: () => add(newShapeLayer("rect")) },
    { id: "bar", label: "Progress bar", hint: "B", shortcut: "b", icon: <Minus />, run: () => add(newShapeLayer("bar")) },
  ];

  function fire(id: string, run: () => void) {
    run();
    setFired(id);
    clearTimeout(firedTimer.current);
    firedTimer.current = setTimeout(() => setFired(null), 400);
  }

  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled && !showCam;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!enabledRef.current) return; // a modal owns the keyboard
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

      // ⌘O / Ctrl+O picks an image file — wins over the browser's own "open file".
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "o") {
        const image = toolsRef.current.find((t) => !t.sep && t.id === "image");
        if (image && !image.sep) { e.preventDefault(); fire(image.id, image.run); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return; // leave the rest of the mod map to App

      const tool = toolsRef.current.find((t) => !t.sep && t.shortcut === e.key.toLowerCase());
      if (!tool || tool.sep) return;
      e.preventDefault();
      fire(tool.id, tool.run);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(firedTimer.current);
    };
  }, []);

  return (
    <>
      {/* One provider for the whole dock, so the row shares a single hover delay
          instead of each tool arming its own. */}
      <StickerTooltipProvider delayDuration={340}>
        <div className="dock anim-dock pointer-events-auto max-w-full overflow-x-auto md:overflow-visible">
          {tools.map((t, i) =>
            t.sep ? (
              <span key={`sep-${i}`} className="dock-sep" />
            ) : (
              <span key={t.id} className="dock-slot">
                <DockButton
                  label={t.toggle && drawMode ? `${t.label} (on)` : t.label}
                  hint={t.hint}
                  cap={t.cap ?? t.shortcut}
                  capMeta={t.capMeta}
                  active={(t.toggle && drawMode) || fired === t.id}
                  onClick={() => fire(t.id, t.run)}
                >
                  {t.icon}
                </DockButton>
                {t.menu && (
                  // Radix owns the dismissal — outside pointerdown, Escape and focus
                  // return — which is what the hand-rolled window listeners here did.
                  <StickerPopoverRoot
                    open={menuFor === t.id}
                    onOpenChange={(open) => setMenuFor(open ? t.id : null)}
                  >
                    <StickerPopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn("dock-more", menuFor === t.id && "dock-more-on")}
                        aria-label={`${t.label}: more options`}
                      >
                        <ChevronUp />
                      </button>
                    </StickerPopoverTrigger>
                    <StickerPopoverContent
                      side="top"
                      align="center"
                      sideOffset={12}
                      arrow={false}
                      className="w-44 p-1"
                    >
                      {t.menu.map((m) => (
                        <button
                          key={m.label}
                          type="button"
                          className="dock-menu-item"
                          onClick={() => { setMenuFor(null); fire(t.id, m.run); }}
                        >
                          <span className="dock-menu-icon">{m.icon}</span>
                          {m.label}
                        </button>
                      ))}
                    </StickerPopoverContent>
                  </StickerPopoverRoot>
                )}
              </span>
            )
          )}
        </div>
      </StickerTooltipProvider>

      {/* Lives outside the buttons so ⌘O and the source menu can both open the picker. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        hidden
        onChange={(e) => { void addImage(e.target.files?.[0]); e.currentTarget.value = ""; }}
      />

      {showCam && (
        <WebcamCapture
          onCapture={(src) => { add(newImageLayer(src)); setShowCam(false); }}
          onClose={() => setShowCam(false)}
        />
      )}
    </>
  );
}

/** A tool plus its tip. The tip carries a real keycap (`StickerKbd`), which depresses
    on the actual keystroke — so pressing T anywhere shows the dock's own key going
    down, and the dock keeps teaching its keyboard map. */
function DockButton({ label, hint, cap, capMeta, onClick, children, active }: { label: string; hint: string; cap?: string; capMeta?: boolean; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <StickerTooltipRoot>
      <StickerTooltipTrigger asChild>
        <button type="button" className={cn("dock-btn", active && "dock-btn-on")} onClick={onClick} aria-label={`${label} (${hint})`} aria-pressed={active}>
          {children}
        </button>
      </StickerTooltipTrigger>
      <StickerTooltipContent side="top" sideOffset={10} arrow={false}>
        <span className="flex items-center gap-2">
          {label}
          <StickerKbd watch={cap} meta={capMeta} className="min-w-5 px-1 py-0 text-[10px]">
            {hint}
          </StickerKbd>
        </span>
      </StickerTooltipContent>
    </StickerTooltipRoot>
  );
}
