# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install        # install deps (npm also works; bun.lock is the source of truth)
bun run dev        # Vite dev server on http://localhost:5174
bun run build      # production build → dist/
bun run check      # tsc --noEmit — the only check; run before every PR, must pass
```

There is **no test suite, linter, or formatter** configured. `bun run check` (TypeScript) is the gate.

Background-removal sidecar (optional, dev only — see `bgremove/README.md`):

```bash
cd bgremove && docker build -t yt-thumb-bgremove . && docker run --rm -p 8000:8000 yt-thumb-bgremove
```

## Architecture

Single-page React editor for YouTube thumbnails (fixed 1280×720). No router, no global state library. Output is a PNG downloaded client-side. The UI strings are in **Italian** — match that when adding user-facing text. There is now an optional backend (`server/`) for accounts + remote project storage; the editor itself is unchanged and still works fully client-side against IndexedDB for the live working canvas.

### The document model is the core abstraction — `src/state.ts`

A thumbnail is a `ThumbDoc` = a `background` + a **flat, ordered array of layers**. Array order *is* paint order (index 0 = back). There is no nesting/grouping; every layer holds its own `x, y` in 1280×720 coordinate space. Four layer types: `TextLayer` (also used for badges/pills via its `bg` field), `ImageLayer` (uploaded/webcam photo, or a built-in Claude brand mark selected by the `brand` field), `EmojiLayer`, `ShapeLayer` (`rect | pill | bar`, where `bar` is the fake YouTube watched-progress bar). Use the `newXxxLayer()` factories — don't hand-build layer objects.

### State = reducer wrapped in a history reducer — `src/state.ts`

`reducer(state, action)` is the pure doc mutator. `historyReducer` wraps it for undo/redo. Two things to preserve when touching it:
- **Gesture coalescing**: continuous edits (drag = burst of `nudge`; slider/color drag = burst of `updateLayer`/`updateBackground` on the same keys) collapse into one history entry via `gestureTag()`. One `Cmd+Z` undoes the whole gesture. New continuous-input actions must return a stable tag from `gestureTag`.
- `HISTORY_LIMIT = 20`. Snapshots share structure by reference, so history stays cheap.

`App.tsx` drives the reducer via `useReducer(historyReducer, …)` and reads `hist.present.{doc,selectedId}`.

### Templates are factories, not modes — `src/presets.ts`

Each entry in `TEMPLATES` is a `() => ThumbDoc` returning fresh layer ids on every call. They seed a starting layer list; the user edits freely afterward. **`TEMPLATES.dacoder` is the default seed** (the @dacoder channel intro) — referenced in `App.tsx` (`initial`) and `NewProjectDialog.tsx` (new blank project). Changing the default means changing both call sites. `TEMPLATE_LABELS` exists for parity but is currently unused.

### Rendering & direct manipulation — `src/components/ThumbCanvas.tsx`

Renders each layer as an absolutely-positioned element inside a node that is `transform: scale()`d to fit the stage. Drag/resize/rotate is hand-rolled with pointer events: screen deltas are divided by `scale` to convert back to canvas units. The `SelectionFrame` resizes around the rotation-invariant centre and clamps the scale factor to each inspector slider's range so canvas and sliders never disagree. The selection outline is hidden during export (`exporting` prop).

### Persistence — `src/lib/storage.ts`

`storage.ts` is the single seam for all persistence, split by concern:
- **Local (IndexedDB, DB name `grocerai-thumb`)** — the autosaved `working` canvas + its project identity (store `meta`). Kept local so the live canvas is fast/offline and holds full base64 data URLs the canvas can paint. **Bumping the schema requires bumping `VERSION` and handling `onupgradeneeded`.**
- **Remote (backend API)** — named, reloadable projects (`listConfigs`/`loadConfig`/`saveConfig`/`renameConfig`/`deleteConfig` → `fetch('/api/...')` via `src/lib/api.ts`). The list returns metadata only (`ConfigMeta`); the full doc is fetched on open.
- Plus JSON file export/import (unchanged) so a project can leave the account.

### Backend, accounts & blob storage — `server/` + `src/lib/blobs.ts`, `src/components/AuthGate.tsx`

`server/` is a Bun + Hono API (Postgres + Cloudflare R2). Accounts are email+password with an httpOnly session cookie; **signup locks after the first user** unless `ALLOW_SIGNUP=true`. `AuthGate` wraps `<App/>` in `main.tsx` so the editor's mount/autosave effects never run until logged in. **Critical blob rule:** the doc keeps images as data URLs *at runtime* (so `html-to-image` export never hits cross-origin canvas taint); R2 offload happens only at the storage boundary — `dehydrateDoc` (data URL → `blob:<id>` ref, uploaded to R2) on save, `hydrateDoc` (ref → data URL, streamed back through our same-origin API) on load. Never make `ThumbCanvas`/`export.ts` consume remote image URLs directly.

### Deployment — `Dockerfile` (web/nginx), `server/Dockerfile` (api), `docker-compose.yml`

One Compose unit: `web` (nginx serves `dist/`, proxies `/api` → `api` same-origin), `api` (Bun), `postgres`. Deployed on a VPS via Dokploy from this repo; secrets (`POSTGRES_PASSWORD`, `R2_*`, `APP_URL`, `ALLOW_SIGNUP`) come from the Dokploy environment — see `.env.example`. Frontend calls the API at relative `/api`, so no build-time URL is needed.

### Background removal — `src/lib/bgremove.ts`

One function, two backends chosen by build mode: **production** uses `@imgly/background-removal` (runs in-browser); **dev** POSTs to the local rembg FastAPI sidecar at `VITE_BGREMOVE_URL` (default `http://localhost:8000`). The pre-cutout image is preserved on the layer as `origSrc` so the operation is reversible ("Ripristina").

### Export — `src/lib/export.ts`

`html-to-image`'s `toPng` captures the canvas node at exactly 1280×720 (transform reset for the capture, then restored), triggers a download, and returns a warning string if the PNG exceeds YouTube's 2 MB limit.

## Conventions

- `src/components/ui/` are shadcn-style Radix primitives; compose them rather than adding new UI libraries. Styling is Tailwind v4 + `cn()` (`clsx` + `tailwind-merge`) in `src/lib/utils.ts`.
- Inline `// ponytail:` comments mark deliberate simplifications with their upgrade path — leave them.
- Coordinates are always in 1280×720 space (`CANVAS_W`/`CANVAS_H`), never screen pixels.
