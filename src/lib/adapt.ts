import { canvasSize, type FormatKey, type Layer, type ThumbDoc } from "../state";

/** Adapt a doc from its own format into `target`: uniform contain-scale + recenter.
 *  Contain (min of the two ratios) guarantees the whole composition fits inside the
 *  new frame. Per-type scaling mirrors the SelectionFrame resize handle (ThumbCanvas)
 *  so canvas resize and adapt never disagree. Same format = identity. Not
 *  pixel-perfect — a usable starting point the user refines by hand. */
export function adaptDocToFormat(doc: ThumbDoc, target: FormatKey): ThumbDoc {
  const { w: sw, h: sh } = canvasSize(doc.format);
  const { w: tw, h: th } = canvasSize(target);
  const f = Math.min(tw / sw, th / sh);
  const offX = (tw - sw * f) / 2;
  const offY = (th - sh * f) / 2;
  const layers = doc.layers.map((l): Layer => {
    const x = l.x * f + offX;
    const y = l.y * f + offY;
    switch (l.type) {
      case "image":
      case "draw":
        return { ...l, x, y, scale: l.scale * f };
      case "shape":
      case "effect":
        return { ...l, x, y, w: l.w * f, h: l.h * f };
      case "text":
      case "emoji":
        return { ...l, x, y, size: Math.round(l.size * f) };
      case "emojifx":
        return { ...l, x, y, size: l.size * f, radius: l.radius * f };
    }
  });
  return { ...doc, format: target, layers };
}
