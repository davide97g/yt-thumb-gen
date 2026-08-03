import { useEffect, useRef, useState } from "react";
import { HudLabel } from "./ui/hud-label";
import { StickerProgressTrack } from "./ui/sticker-progress";
import { cn } from "../lib/utils";

/** Held on screen at least this long once shown. A loader that appears for 80ms and vanishes
 *  reads as a glitch, not as feedback — and opening from IndexedDB is often that fast. */
const MIN_VISIBLE = 460;
/** Must match the `loader-out` / `loader-card-out` animations in `styles.css`. */
const EXIT = 340;

type Props = {
  active: boolean;
  /** What is being loaded, in words: "Opening “Launch trailer”", "Restoring your canvas". */
  label: string;
  /** The open format's aspect, so the miniature is the shape of the thing being loaded. */
  aspect?: number;
};

/**
 * The overlay the stage wears while a document is on its way in.
 *
 * It exists because the editor mounts on the seeded template and only *then* hydrates: without
 * a cover, opening a project shows someone else's design for as long as the fetch takes (a
 * hydrated doc carries full-resolution images inline, so that is not always brief). The
 * backdrop is near-opaque for that reason — it is hiding a wrong answer, not dimming a right
 * one — and the exit fade is the reveal of the real design.
 *
 * The animation is the document model: a miniature of the canvas assembles itself out of
 * layer plates, back to front, in paint order — exactly what the loaded document is about to
 * do for real. Then a lime sweep carries the wait, because the assembly is a one-shot: a
 * stack that endlessly rebuilds itself would read as a retry loop.
 *
 * Everything moves on `transform`/`opacity` only, and `styles.css` collapses all of it under
 * `prefers-reduced-motion` — the plates land in their final position and the frame just sits
 * there with the indeterminate bar, which is the whole message anyway.
 */
export function ProjectLoading({ active, label, aspect = 16 / 9 }: Props) {
  // "gone" is unmounted; "out" is the exit animation still playing. Kept in state rather
  // than left to the caller so the reveal can't be cut off by the doc swap that ends the load.
  const [phase, setPhase] = useState<"in" | "out" | "gone">(active ? "in" : "gone");
  const shownAt = useRef(0);

  useEffect(() => {
    if (active) {
      shownAt.current = performance.now();
      setPhase("in");
      return;
    }
    const wait = Math.max(0, MIN_VISIBLE - (performance.now() - shownAt.current));
    const leave = setTimeout(() => setPhase("out"), wait);
    const done = setTimeout(() => setPhase("gone"), wait + EXIT);
    return () => { clearTimeout(leave); clearTimeout(done); };
  }, [active]);

  if (phase === "gone") return null;

  return (
    <div
      className={cn("loader-overlay", phase === "out" && "loader-overlay-out")}
      // The load is the whole screen's state, so it's announced once rather than per element.
      role="status"
      aria-live="polite"
      aria-busy
    >
      <div className="loader-card">
        <div className="loader-frame" style={{ aspectRatio: String(aspect) }} aria-hidden>
          {/* Paint order, and therefore arrival order: background, badge, title, subtitle,
              photo, watched-bar — the same order a template seeds its layers in. */}
          <span className="loader-plate loader-wash" />
          <span className="loader-plate loader-badge" />
          <span className="loader-plate loader-title" />
          <span className="loader-plate loader-sub" />
          <span className="loader-plate loader-photo" />
          <span className="loader-wipe loader-bar" />
          <span className="loader-sweep" />
          <span className="loader-bracket loader-bracket-tl" />
          <span className="loader-bracket loader-bracket-tr" />
          <span className="loader-bracket loader-bracket-bl" />
          <span className="loader-bracket loader-bracket-br" />
        </div>

        <div className="loader-meta">
          <HudLabel size="sm" tracking="tight" className="readout max-w-full truncate text-muted-foreground">
            {label}
            <span className="loader-dots" aria-hidden>
              <i /><i /><i />
            </span>
          </HudLabel>
          <StickerProgressTrack size="sm" label={label} className="loader-track" />
        </div>
      </div>
    </div>
  );
}
