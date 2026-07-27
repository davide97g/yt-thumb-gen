---
name: thumb-studio
description: Design social/marketing graphics in Thumb Studio — YouTube thumbnails, Shorts covers, Instagram posts and reels, LinkedIn cards. Use when asked to create, restyle, or adapt a thumbnail, cover, or social graphic, or to work with a saved Thumb Studio project. Requires the thumb-studio MCP server.
---

# Thumb Studio

Compose a design as a `ThumbDoc` and save it to the user's account. The saved project opens in
the editor, where the user finishes it by hand.

## Procedure

1. **`get_design_reference`** first, always. Canvas dimensions differ per format and every
   coordinate you write depends on them.
2. **Pick the format** from the user's intent — YouTube thumbnail, Reel, LinkedIn card. Ask only
   if genuinely ambiguous.
3. **Start from a template.** `list_templates` then `get_template` with the target `format`. The
   templates are tuned; composing from an empty canvas usually looks worse. Only start blank if
   the user asks for something no template resembles.
4. **Edit the document.** Change copy, colours, and positions; delete layers you don't need. Use
   `new_layer` for anything you add — it returns valid defaults for every required field.
5. **`create_project`** (or `update_project` for an existing one). It validates locally first, so
   schema errors come back without a round trip.
6. **Give the user the URL** from the response. Say plainly that you composed it blind and they
   should check it.

## The format

`ThumbDoc = { format, background, layers }`. `layers` is flat and ordered — **index 0 paints
first (backmost)**. There is no nesting. Every layer holds absolute `x`/`y` of its top-left
corner. Full field reference: `reference/doc-format.md`, or `get_doc_schema` for the raw schema.

## Rules that the schema cannot enforce

**Coordinates are per-format.** `new_layer` and the templates are authored in 1280×720. A Reel is
1080×1920 — an `x` of 1120 is off-canvas there. Always reposition against the dimensions from
`get_design_reference`. Pass `format` to `get_template` and it rescales for you; layers you add
afterwards are your responsibility.

**You cannot upload images.** No tool sends bytes. Compose with text, shapes, emoji, draw strokes,
gradients and effects. For imagery use `brand-logo` / `brand-wordmark` (built-in Claude marks, no
upload). A template's photo layers arrive as empty slots (`src: null`) — leave them for the user
to fill, or delete them. Never invent a `src`: a fabricated URL or data URL will not render.

**Legibility beats cleverness.** A thumbnail is judged at ~320px wide on a phone.

- 2–5 words of headline. A sentence is not a thumbnail.
- Title `size` 90–140 in 1280×720 space; scale proportionally for other formats.
- Keep text inside a ~60px margin. Nothing important in the bottom-right — the platform stamps a
  duration badge there.
- Enable `stroke` or `shadow` on text over any busy or mid-tone background. Raise
  `background.overlay` (0–100) rather than dimming the text colour.
- 4–8 layers total. Crowding is the most common failure.

**Colour.** Pick one accent and repeat it — heading, pill, brand mark. Templates already carry a
coherent palette; change the hue, keep the relationships.

## Editing an existing project

`list_projects` → `get_project` → modify → `update_project` with the same id. Change only what was
asked; the user's other layers are their work, not yours. Rename by passing `name` alone.

`delete_project` is permanent — confirm with the user before calling it.

## Setup

The MCP server needs `THUMB_API_TOKEN` in the environment. The user mints one in the editor via
the key icon in the header (Token API). If a tool reports a missing token, point them there.
