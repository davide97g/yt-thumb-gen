// What the platform paints on top of your design, and what it cuts off.
//
// A thumbnail is never seen the way it is authored: YouTube stamps a duration pill over
// the bottom-right corner and a red progress bar along the bottom of anything you have
// already watched, a Short is framed by the action rail and the caption, and Instagram
// crops a 4:5 post to a square in the profile grid. Composing without knowing that is how
// a face ends up under the like button.
//
// Zones are fractions of the canvas (0–1), not pixels, so one table covers every format.
// They are deliberately approximate — platform chrome moves between clients and releases.
// The point is "don't put anything important here", not a pixel-exact mock.

import type { FormatKey } from "../state";

export type SafeZone = {
  id: string;
  label: string;
  /** `cover` = platform UI paints over this box. `keep` = only this box survives; the rest
   *  is cropped away on some surface (e.g. the Instagram profile grid). */
  kind: "cover" | "keep";
  /** Fractions of canvas width/height. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export const SAFE_ZONES: Record<FormatKey, SafeZone[]> = {
  youtube: [
    { id: "duration", label: "Duration", kind: "cover", x: 0.8, y: 0.79, w: 0.185, h: 0.16 },
    // Every video the viewer has already opened wears this. It is also why the editor has a
    // fake progress-bar shape: designs often lean into it rather than fight it.
    { id: "progress", label: "Watched bar", kind: "cover", x: 0, y: 0.96, w: 1, h: 0.04 },
  ],
  shorts: [
    { id: "header", label: "Top bar", kind: "cover", x: 0, y: 0, w: 1, h: 0.09 },
    { id: "rail", label: "Action rail", kind: "cover", x: 0.8, y: 0.42, w: 0.2, h: 0.48 },
    { id: "caption", label: "Title & handle", kind: "cover", x: 0, y: 0.8, w: 0.8, h: 0.2 },
  ],
  "ig-reel": [
    { id: "header", label: "Top bar", kind: "cover", x: 0, y: 0, w: 1, h: 0.08 },
    { id: "rail", label: "Action rail", kind: "cover", x: 0.82, y: 0.4, w: 0.18, h: 0.48 },
    { id: "caption", label: "Caption", kind: "cover", x: 0, y: 0.78, w: 0.82, h: 0.22 },
  ],
  // The feed shows the whole 4:5, but the profile grid cell is a centre square — 20% of the
  // height, split top and bottom, never makes it to anyone browsing your profile.
  "ig-post": [{ id: "grid-crop", label: "Grid crop (1:1)", kind: "keep", x: 0, y: 0.1, w: 1, h: 0.8 }],
  // LinkedIn renders a 4:5 image whole in the feed and adds no overlay of its own.
  linkedin: [],
};

/** Width in CSS pixels of the smallest surface this format is commonly seen at — a grid
 *  cell or shelf card, not a full-screen player. This is the size the design actually has
 *  to survive, and what the "actual size" toggle and the readability check both use. */
export const GRID_W: Record<FormatKey, number> = {
  youtube: 210, // desktop home/search grid card
  shorts: 160, // Shorts shelf card
  "ig-post": 143, // profile grid cell (3 across on a phone)
  "ig-reel": 143, // reels grid cell
  linkedin: 200, // feed image at desktop column width, scaled down
};
