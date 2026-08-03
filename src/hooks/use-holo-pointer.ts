"use client";

import * as React from "react";

export interface UseHoloPointerOptions {
  /** Max tilt in degrees on each axis. Set 0 for foil-only, no rotation. */
  tilt?: number;
  /** Max magnetic pull in px toward the pointer. */
  magnet?: number;
  /** Return to rest when the pointer leaves. */
  reset?: boolean;
  /** Skip all pointer work. */
  disabled?: boolean;
}

/**
 * useHoloPointer — writes pointer position into CSS custom properties so
 * foil, tilt and magnetism can be driven entirely by CSS.
 *
 *   --fx / --fy   pointer position inside the element, 0-100
 *   --rx / --ry   tilt angles in deg
 *   --mx / --my   magnetic offset in px
 *
 * Values are written straight to the node inside a rAF, so React never
 * re-renders while the pointer moves. Honors prefers-reduced-motion.
 */
export function useHoloPointer<T extends HTMLElement = HTMLDivElement>({
  tilt = 8,
  magnet = 0,
  reset = true,
  disabled = false,
}: UseHoloPointerOptions = {}) {
  const ref = React.useRef<T>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let rect: DOMRect | null = null;
    let frame = 0;
    let x = 50;
    let y = 50;

    const paint = () => {
      frame = 0;
      el.style.setProperty("--fx", x.toFixed(2));
      el.style.setProperty("--fy", y.toFixed(2));
      if (tilt) {
        el.style.setProperty("--ry", `${(((x - 50) / 50) * tilt).toFixed(2)}deg`);
        el.style.setProperty("--rx", `${(((50 - y) / 50) * tilt).toFixed(2)}deg`);
      }
      if (magnet) {
        el.style.setProperty("--mx", `${(((x - 50) / 50) * magnet).toFixed(2)}px`);
        el.style.setProperty("--my", `${(((y - 50) / 50) * magnet).toFixed(2)}px`);
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const measure = () => {
      rect = el.getBoundingClientRect();
    };

    const onEnter = () => {
      measure();
      el.dataset.holo = "active";
    };

    const onMove = (event: PointerEvent) => {
      if (!rect) measure();
      if (!rect || !rect.width || !rect.height) return;
      x = ((event.clientX - rect.left) / rect.width) * 100;
      y = ((event.clientY - rect.top) / rect.height) * 100;
      schedule();
    };

    const onLeave = () => {
      rect = null;
      delete el.dataset.holo;
      if (!reset) return;
      x = 50;
      y = 50;
      schedule();
    };

    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", measure);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", measure);
    };
  }, [tilt, magnet, reset, disabled]);

  return ref;
}
