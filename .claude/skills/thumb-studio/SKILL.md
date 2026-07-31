---
name: thumb-studio
description: Design social/marketing graphics in Thumb Studio — YouTube thumbnails, Shorts covers, Instagram posts and reels, LinkedIn cards — and ship one message across every platform as a campaign. Use when asked to create, restyle, or adapt a thumbnail, cover, or social graphic, to build a multi-platform campaign, or to work with a saved Thumb Studio project. Requires the thumb-studio MCP server.
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

## Campaigns — one message, every platform

A campaign is a folder of designs that usually start as the same idea rescaled per platform. A
project belongs to at most one campaign.

**When the user wants more than one platform, use `generate_campaign_set`.** Compose the design
*once*, in the format it suits best, then hand it over with the list of targets:

```
generate_campaign_set(name: "Lancio autunno", doc: <master>, formats: ["youtube","ig-reel","linkedin"])
```

It creates the campaign, rescales the document into each format, and saves one project per
format. Report the per-format links it returns.

Things worth knowing:

- **The variants are independent from the moment they're saved.** Editing one does not update the
  others. If the headline changes, either regenerate the set or update each design.
- Rescaling is *contain* — it fits the whole 16:9 composition inside a 9:16 frame, which leaves
  large empty bands. It's a correct starting point, not a finished vertical design. Say so, and
  offer to rework the tall formats properly (bigger type, stacked layout) rather than pretending
  the auto-fit is done.
- Designs are named `<campaign> — <format label>`; the archive strips that prefix when showing
  them inside their group. Keep the convention.
- `delete_campaign` deletes only the folder — its designs survive, ungrouped. Deleting the
  designs is a separate, per-project action.
- Use `create_campaign` + `set_project_campaign` only to organise designs that already exist.

## Editing an existing project

`list_projects` → `get_project` → modify → `update_project` with the same id. Change only what was
asked; the user's other layers are their work, not yours. Rename by passing `name` alone.

Every project tool's `id` also accepts an editor URL — the address bar carries `?project=<id>`, so
when the user pastes `https://…/?project=<uuid>`, hand it straight to `get_project`.

`delete_project` is permanent — confirm with the user before calling it.

## Setup

The tools reach Thumb Studio with a personal API token. The user gets a ready-made snippet from
**Aggiungi MCP** in the editor header — it covers Claude Code, Codex, Cursor and raw JSON, and
points at the hosted endpoint (`/api/mcp`), so nothing needs installing. If a tool reports a
missing or rejected token, send them there; tokens are shown once, so a lost one is replaced,
not recovered.
