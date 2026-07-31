import { useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import { Camera, ChevronUp, ImagePlus, Minus, Pencil, Smile, Square, Type, Upload } from "lucide-react";
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
    a tool driven by a chord (image = ⌘O) can still show it. */
type DockItem =
  | { sep: true }
  | {
      sep?: false;
      id: string;
      label: string;
      hint: string;
      shortcut?: string;
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

  // Any pointer down outside the open source menu, or Escape, dismisses it.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menuFor]);

  return (
    <>
      <div className="dock anim-dock pointer-events-auto max-w-full overflow-x-auto md:overflow-visible">
        {tools.map((t, i) =>
          t.sep ? (
            <span key={`sep-${i}`} className="dock-sep" />
          ) : (
            <span key={t.id} className="dock-slot">
              <DockButton
                label={t.toggle && drawMode ? `${t.label} (on)` : t.label}
                hint={t.hint}
                active={(t.toggle && drawMode) || fired === t.id}
                onClick={() => fire(t.id, t.run)}
              >
                {t.icon}
              </DockButton>
              {t.menu && (
                <>
                  <button
                    type="button"
                    className={cn("dock-more", menuFor === t.id && "dock-more-on")}
                    aria-label={`${t.label}: more options`}
                    aria-expanded={menuFor === t.id}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setMenuFor((m) => (m === t.id ? null : t.id))}
                  >
                    <ChevronUp />
                  </button>
                  {menuFor === t.id && (
                    <div className="dock-menu" onPointerDown={(e) => e.stopPropagation()}>
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
                    </div>
                  )}
                </>
              )}
            </span>
          )
        )}
      </div>

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

function DockButton({ label, hint, onClick, children, active }: { label: string; hint: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button type="button" className={cn("dock-btn", active && "dock-btn-on")} onClick={onClick} aria-label={`${label} (${hint})`} aria-pressed={active}>
      {children}
      <span className="dock-tip">
        {label}
        <kbd className="dock-key">{hint}</kbd>
      </span>
    </button>
  );
}
