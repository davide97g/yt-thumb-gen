<div align="center">

# 🎬 Thumb Studio

**A fast, local-first YouTube thumbnail editor — built live on [@dacoder](https://www.youtube.com/@dacoder).**

Layer-based canvas, in-browser background removal, one-click 1280×720 PNG export. No accounts, no backend, your work never leaves the browser.

![License](https://img.shields.io/badge/license-MIT-3ddc84)
![React](https://img.shields.io/badge/React-19-149eca)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6)
![Vite](https://img.shields.io/badge/Vite-8-646cff)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8)

</div>

<!-- Drop a screenshot/GIF of the editor here once you have one:
![Thumb Studio](docs/screenshot.png) -->

---

## What it is

A single-page editor for designing YouTube thumbnails at the exact 1280×720 spec.
Everything is a freely-positioned **layer** — text, photos, emoji, shapes — that you
drag, resize, and rotate directly on the canvas. Photos can be cut out from their
background, the whole thing exports to a YouTube-ready PNG, and your work autosaves
to the browser so a refresh never loses anything.

It ships with **templates** (the default seeds the *@dacoder* channel intro) you
edit per video, plus the Claude brand marks for the live-coding episodes it was built for.

## Features

- 🧱 **Layer-based canvas** — text, image, emoji, and shape layers, each freely placed in 1280×720 space with drag / resize / rotate handles.
- ✂️ **Background removal** — cut out a face/photo in one click. Runs **fully in-browser** in production, or via an optional local [rembg](https://github.com/danielgatis/rembg) sidecar in dev.
- 📸 **Photo import** — upload or capture from webcam; HEIC photos auto-convert.
- 🎨 **Templates** — opinionated starting points (loud, brand, dev, hype, number, before/after, minimal) that seed a fresh layer list.
- ↩️ **Undo / redo** — full history with smart gesture-coalescing (one drag = one undo).
- 💾 **Local persistence** — working canvas autosaves to IndexedDB; name and reload saved projects; export/import projects as JSON.
- ⬇️ **Export** — captures the canvas at exact 1280×720 and warns if the PNG exceeds YouTube's 2 MB limit.
- ⌨️ Keyboard shortcuts (delete layer, copy/paste, `\` to hide all panels for a full-bleed preview).

## Quick start

```bash
bun install        # or: npm install
bun run dev        # Vite dev server on http://localhost:5174
bun run build      # production build → dist/
bun run check      # tsc --noEmit
```

> Background removal is optional in dev and built-in in production — see [below](#background-removal).

## Tech stack

| Area | Choice |
|------|--------|
| **Framework** | [React 19](https://react.dev) + [Vite 8](https://vite.dev) |
| **Language** | [TypeScript 6](https://www.typescriptlang.org) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com) (`@tailwindcss/vite`) |
| **UI primitives** | [Radix UI](https://www.radix-ui.com) (select / slider / switch), [lucide-react](https://lucide.dev) icons, `cva` + `clsx` + `tailwind-merge` (shadcn-style) |
| **Fonts** | Self-hosted display faces via [Fontsource](https://fontsource.org) (Anton, Archivo Black, Bebas Neue, Oswald, League Gothic, Inter) |
| **Image export** | [`html-to-image`](https://github.com/bubkoo/html-to-image) |
| **Background removal** | [`@imgly/background-removal`](https://github.com/imgly/background-removal-js) (browser) · [rembg](https://github.com/danielgatis/rembg) + [FastAPI](https://fastapi.tiangolo.com) sidecar (dev) |
| **Photo input** | `heic2any` (HEIC→PNG), `getUserMedia` (webcam) |
| **State** | `useReducer` + a hand-rolled undo/redo history wrapper — no state library |
| **Persistence** | IndexedDB (raw) + JSON file export/import |
| **Tooling** | [Bun](https://bun.sh) (lockfile / runner), deployable as a static SPA to [Vercel](https://vercel.com) |

## Understanding the project

You only need to hold a few ideas in your head to work on this codebase.

### 1. The document model is everything — [`src/state.ts`](src/state.ts)

A thumbnail is a **`ThumbDoc`**: a `background` plus a **flat, ordered list of layers**.
Array order *is* paint order (index 0 = back, last = front). There is no nesting and
no grouping — every layer carries its own `x, y` in 1280×720 space and is individually
selectable, draggable, and resizable.

```
ThumbDoc
├── background        gradient | solid | image (+ darkness overlay)
└── layers[]          back → front
    ├── TextLayer     title lines, badges, episode pills (pill = text + bg)
    ├── ImageLayer    uploaded photo, webcam capture, or a Claude brand mark
    ├── EmojiLayer    a single glyph
    └── ShapeLayer    rect | pill | fake YouTube "watched" progress bar
```

**Templates** ([`src/presets.ts`](src/presets.ts)) are not a mode you live in — each is just
a factory returning a fresh `ThumbDoc` (new layer ids every call). The default seed is the
`dacoder` template (the channel intro). Editing means adding/moving/deleting layers afterward.

### 2. State = reducer + history — [`src/state.ts`](src/state.ts)

A single `reducer` mutates the doc (add/update/remove/reorder/nudge layers). It's wrapped
by a `historyReducer` giving undo/redo with two tricks worth knowing:
- **Gesture coalescing** — a continuous drag or slider sweep collapses into *one* history
  entry via a `tag`, so `Cmd+Z` undoes the whole gesture, not one pixel.
- **20-entry limit**, with snapshots sharing structure so history is cheap.

### 3. Rendering & direct manipulation — [`src/components/ThumbCanvas.tsx`](src/components/ThumbCanvas.tsx)

The canvas renders every layer as an absolutely-positioned element and `transform: scale()`s
the whole thing to fit the viewport. The selected layer gets a `SelectionFrame` whose corner
handles resize (around the rotation-invariant centre) and whose top knob rotates — pointer
deltas are divided by the screen scale so they map back to canvas units.

### 4. Persistence — [`src/lib/storage.ts`](src/lib/storage.ts)

Docs embed images as base64 data URLs, so a single doc can be several MB — past the
localStorage cap. Everything lives in **IndexedDB**: the `working` canvas is autosaved
(debounced) on every edit, and named projects live in a `configs` store. JSON export/import
lets projects survive a cache clear or move between machines.

### 5. Background removal — [`src/lib/bgremove.ts`](src/lib/bgremove.ts)

Two backends behind one call:
- **Production** → [`@imgly/background-removal`](https://github.com/imgly/background-removal-js) runs entirely in the browser.
- **Dev** → an optional local [rembg](https://github.com/danielgatis/rembg) FastAPI sidecar (see [`bgremove/`](bgremove/README.md)).

The original image is kept on the layer (`origSrc`) so the cutout is reversible.

### 6. Export — [`src/lib/export.ts`](src/lib/export.ts)

`html-to-image` captures the canvas node at exactly 1280×720 (transform reset for the
capture), triggers a PNG download, and warns if the result exceeds YouTube's 2 MB limit.

> **Note:** the UI is in **Italian** — strings, layer names, and template labels.

## Project structure

```
.
├── index.html               # Vite entry
├── src/
│   ├── App.tsx              # editor shell: top bar, rails, stage, dialogs
│   ├── state.ts             # ThumbDoc model + reducer + undo/redo history
│   ├── presets.ts           # templates (factories → fresh ThumbDoc)
│   ├── components/          # canvas, inspector, layer list, toolbar, dialogs…
│   │   └── ui/              # shadcn-style Radix primitives
│   └── lib/                 # storage, export, bgremove, image loading
└── bgremove/                # optional Python rembg sidecar (dev only)
```

## Background removal

The in-browser path needs no setup. To use the faster/heavier local sidecar in dev,
the quickest route is Docker:

```bash
cd bgremove
docker build -t yt-thumb-bgremove .
docker run --rm -p 8000:8000 yt-thumb-bgremove
```

Point the editor elsewhere with `VITE_BGREMOVE_URL` in a root `.env`
(default `http://localhost:8000`). Full instructions: [`bgremove/README.md`](bgremove/README.md).

## Contributing

Issues and PRs welcome. Before opening a PR, run `bun run check` (it must pass) and keep
the layer model in mind — most features are "a new layer type" or "a new inspector control",
not new architecture.

## License

[MIT](LICENSE) © Davide Ghiotto · made for [@dacoder](https://www.youtube.com/@dacoder)
