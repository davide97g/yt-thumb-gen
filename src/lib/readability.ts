// Will this design survive the feed?
//
// The editor shows the design at 40% of a 1280-wide canvas on a big monitor. The viewer
// sees it at 210 CSS pixels next to eleven others, with a duration pill over one corner.
// Almost every bad thumbnail is bad for one of four reasons, and all four are checkable:
// text too small to read at grid size, text that doesn't separate from what's behind it,
// something important parked under platform chrome, and too many words.
//
// Pure and box-driven: layer geometry comes in already measured (the canvas is the only
// thing that knows how wide a run of text rendered), so this stays unit-testable.

import type { Box } from "./layout";
import { GRID_W, SAFE_ZONES } from "./safeAreas";
import { FORMATS, type ThumbDoc } from "../state";

export type Issue = {
  /** Stable per (rule, layer) so React keys and dedupe are free. */
  id: string;
  /** Set when the issue is about one layer, so the panel can select it. */
  layerId?: string;
  severity: "warn" | "info";
  message: string;
};

/** Below this many CSS pixels at grid size, a line stops being read and becomes texture. */
const MIN_TEXT_PX = 10;
/** WCAG's large-text floor. Thumbnail text is always "large", so 3:1 is the honest bar. */
const MIN_CONTRAST = 3;
/** A stroke this thick separates text from anything, which makes contrast moot. */
const RESCUING_STROKE = 3;
/** Past this, the eye stops reading in a feed and starts skipping. */
const MAX_WORDS = 8;
/** Fraction of a layer that has to fall under platform chrome before it's worth a warning. */
const COVER_TOLERANCE = 0.15;
/** Same idea for the crop: a sliver outside the kept square is fine, a corner is not. */
const CROP_TOLERANCE = 0.05;

// ── colour ────────────────────────────────────────────────────────────────────

/** #rgb / #rrggbb → [r,g,b]. Anything else (named colours, rgb(), gradients) → null, and
 *  the rule that needed it is skipped rather than guessed at. */
export function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1];
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: [number, number, number]): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG contrast ratio, 1 (identical) … 21 (black on white). */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  const la = luminance(ca);
  const lb = luminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Midpoint of two colours — stands in for the gradient behind a layer, since we don't
 *  know which end of it the text landed on. */
function mixHex(a: string, b: string): string | null {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  return "#" + ca.map((v, i) => Math.round((v + cb[i]) / 2).toString(16).padStart(2, "0")).join("");
}

// ── geometry ──────────────────────────────────────────────────────────────────

const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// ── the check ─────────────────────────────────────────────────────────────────

/** Runs every rule over a document. `boxes` maps layer id → its rendered box in canvas
 *  units; layers missing from it simply skip the geometry rules. */
export function checkReadability(doc: ThumbDoc, boxes: Record<string, Box>): Issue[] {
  const fmt = FORMATS[doc.format];
  const gridScale = GRID_W[doc.format] / fmt.w;
  const issues: Issue[] = [];
  const visible = doc.layers.filter((l) => l.visible);

  for (const l of visible) {
    if (l.type !== "text" || !l.text.trim()) continue;

    // 1. Too small to read where it will be seen.
    const px = l.size * gridScale;
    if (px < MIN_TEXT_PX) {
      issues.push({
        id: `size:${l.id}`,
        layerId: l.id,
        severity: "warn",
        message: `“${l.name}” renders at ~${px.toFixed(0)}px in the feed — under ${MIN_TEXT_PX}px it reads as a smudge.`,
      });
    }

    // 2. Nothing separating the text from what's behind it. A thick stroke settles the
    //    question on its own, so it short-circuits the rule.
    if (!(l.stroke && l.strokeWidth >= RESCUING_STROKE)) {
      const behind = l.bg.enabled
        ? l.bg.color
        : doc.background.mode === "solid"
          ? doc.background.from
          : doc.background.mode === "gradient"
            ? mixHex(doc.background.from, doc.background.to)
            : null;
      const ratio = behind ? contrastRatio(l.color, behind) : null;
      if (ratio !== null && ratio < MIN_CONTRAST) {
        issues.push({
          id: `contrast:${l.id}`,
          layerId: l.id,
          severity: "warn",
          message: `“${l.name}” has ${ratio.toFixed(1)}:1 contrast against what's behind it — aim for ${MIN_CONTRAST}:1. Change the colour, or add a stroke.`,
        });
      } else if (ratio === null && (doc.background.mode === "image" || doc.background.mode === "effect") && doc.background.overlay < 20) {
        issues.push({
          id: `scrim:${l.id}`,
          layerId: l.id,
          severity: "info",
          message: `“${l.name}” sits on a busy background with almost no scrim — raise Overlay, or give the text a stroke.`,
        });
      }
    }
  }

  // 3. Under the platform's own chrome, or outside the crop it will be shown through.
  for (const zone of SAFE_ZONES[doc.format]) {
    const zoneBox: Box = { x: zone.x * fmt.w, y: zone.y * fmt.h, w: zone.w * fmt.w, h: zone.h * fmt.h };
    for (const l of visible) {
      const box = boxes[l.id];
      if (!box || area(box) === 0) continue;
      if (l.type === "effect" || l.type === "emojifx") continue; // decoration, not content
      if (zone.kind === "cover") {
        if (overlapArea(box, zoneBox) / area(box) > COVER_TOLERANCE) {
          issues.push({
            id: `zone:${zone.id}:${l.id}`,
            layerId: l.id,
            severity: "warn",
            message: `“${l.name}” sits under the ${zone.label.toLowerCase()} — ${fmt.platform} paints over it.`,
          });
        }
      } else if ((area(box) - overlapArea(box, zoneBox)) / area(box) > CROP_TOLERANCE) {
        issues.push({
          id: `zone:${zone.id}:${l.id}`,
          layerId: l.id,
          severity: "warn",
          message: `“${l.name}” falls outside the ${zone.label.toLowerCase()} — it's cut off wherever that crop is used.`,
        });
      }
    }
  }

  // 4. Too much copy. One issue for the whole doc: it's a composition problem, not a layer's.
  const words = visible
    .filter((l) => l.type === "text")
    .reduce((n, l) => n + (l.type === "text" ? l.text.trim().split(/\s+/).filter(Boolean).length : 0), 0);
  if (words > MAX_WORDS) {
    issues.push({
      id: "words",
      severity: "info",
      message: `${words} words of copy — thumbnails that get clicked usually run 3–5. Cut, or make one phrase dominant.`,
    });
  }

  // Warnings first: the list is read top-down and the panel truncates.
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1));
}
