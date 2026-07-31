# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install        # install deps (npm also works; bun.lock is the source of truth)
bun run dev        # Vite dev server on http://localhost:5174 (proxies /api → VITE_API_PROXY)
bun run build      # production build → dist/
bun run schema     # regenerate server/src/generated/thumbdoc.schema.json from src/state.ts
bun run test       # bun test
bun run check      # tsc --noEmit + schema drift check + tests — the gate, must pass before every PR
```

There is **no linter or formatter** configured. `bun run check` is the gate: it runs TypeScript,
asserts the generated JSON Schema is not stale, and runs `bun test`.

`server/` and `mcp/` are separate packages with their own deps and tsconfigs — typecheck them
explicitly (`bunx tsc --noEmit -p server`, `-p mcp`) after touching them; the root `check` does
not. Root `bun test` reaches into `server/src/validate.ts`, which is why `ajv` is a root devDep
too: it lets one `bun install` at the root run the whole suite.

**Any change to the layer/document types in `src/state.ts` requires `bun run schema`** and
committing the regenerated file, or `check` fails.

Background-removal sidecar (optional, dev only — see `bgremove/README.md`):

```bash
cd bgremove && docker build -t yt-thumb-bgremove . && docker run --rm -p 8000:8000 yt-thumb-bgremove
```

## Architecture

Single-page React editor for YouTube thumbnails (fixed 1280×720). No router, no global state library. Output is a PNG downloaded client-side. The UI strings are in **Italian** — match that when adding user-facing text. There is now an optional backend (`server/`) for accounts + remote project storage; the editor itself is unchanged and still works fully client-side against IndexedDB for the live working canvas.

### The document model is the core abstraction — `src/state.ts`

A thumbnail is a `ThumbDoc` = a `format` + a `background` + a **flat, ordered array of layers**. Array order *is* paint order (index 0 = back). There is no nesting; every layer holds its own `x, y` in 1280×720 authoring space (`groupId` is a logical grouping only). Seven layer types: `TextLayer` (also used for badges/pills via its `bg` field), `ImageLayer` (uploaded/webcam photo, or a built-in Claude brand mark selected by the `brand` field), `EmojiLayer`, `ShapeLayer` (`rect | pill | bar`, where `bar` is the fake YouTube watched-progress bar), `EffectLayer`, `DrawLayer`, `EmojiFxLayer`. Use the `newXxxLayer()` factories — don't hand-build layer objects.

`LayerBase` deliberately does **not** declare `type`; each concrete layer declares its own literal. That keeps the union discriminated in the generated JSON Schema — don't move `type` back into the base.

Field comments on layer types use `/** */`, not trailing `//`, because the generator only carries JSDoc blocks into the schema. That text is the agent-facing documentation of the format — keep it that way when adding fields.

### State = reducer wrapped in a history reducer — `src/state.ts`

`reducer(state, action)` is the pure doc mutator. `historyReducer` wraps it for undo/redo. Two things to preserve when touching it:
- **Gesture coalescing**: continuous edits (drag = burst of `nudge`; slider/color drag = burst of `updateLayer`/`updateBackground` on the same keys) collapse into one history entry via `gestureTag()`. One `Cmd+Z` undoes the whole gesture. New continuous-input actions must return a stable tag from `gestureTag`.
- `HISTORY_LIMIT = 20`. Snapshots share structure by reference, so history stays cheap.

`App.tsx` drives the reducer via `useReducer(historyReducer, …)` and reads `hist.present.{doc,selectedId}`.

### Templates are factories, not modes — `src/presets.ts`

Each entry in `TEMPLATES` is a `() => ThumbDoc` returning fresh layer ids on every call. They seed a starting layer list; the user edits freely afterward. **`TEMPLATES.dacoder` is the default seed** (the @dacoder channel intro) — referenced in `App.tsx` (`initial`) and `NewProjectDialog.tsx` (new blank project). Changing the default means changing both call sites. `TEMPLATE_LABELS` exists for parity but is currently unused.

### Rendering & direct manipulation — `src/components/ThumbCanvas.tsx`

Renders each layer as an absolutely-positioned element inside a node that is `transform: scale()`d to fit the stage. Drag/resize/rotate is hand-rolled with pointer events: screen deltas are divided by `scale` to convert back to canvas units. The `SelectionFrame` resizes around the rotation-invariant centre and clamps the scale factor to each inspector slider's range so canvas and sliders never disagree. The selection outline is hidden during export (`exporting` prop).

### Layer list — `src/components/LayerList.tsx`

The list paints **front-first** (row 0 = last layer in the array), and rows are drag-reorderable with hand-rolled pointer events (no dnd library). Two things follow from the inversion: the drop indicator is an absolutely-positioned overlay (inserting a real element between rows would shift the rows being measured), and a visual gap `slot` becomes a doc gap as `layers.length - slot` before it goes to the `moveLayers` action. `moveLayers` lifts the whole selection out keeping its relative order and reinserts it at that gap, rebasing the gap onto the lifted array so the block lands where the indicator was. Touch/pen must drag from the grip handle — dragging the row body is mouse-only, or a swipe could never scroll the rail. Selection modifiers are the platform-standard ones: plain click replaces, ⌘/Ctrl toggles a row, Shift extends from the last clicked row (group mates always come along).

### Persistence — `src/lib/storage.ts`

`storage.ts` is the single seam for all persistence, split by concern:
- **Local (IndexedDB, DB name `grocerai-thumb`)** — the autosaved `working` canvas + its project identity (store `meta`). Kept local so the live canvas is fast/offline and holds full base64 data URLs the canvas can paint. **Bumping the schema requires bumping `VERSION` and handling `onupgradeneeded`.**
- **Remote (backend API)** — named, reloadable projects (`listConfigs`/`loadConfig`/`saveConfig`/`renameConfig`/`deleteConfig` → `fetch('/api/...')` via `src/lib/api.ts`). The list returns metadata only (`ConfigMeta`); the full doc is fetched on open.
- Plus JSON file export/import (unchanged) so a project can leave the account.

### Backend, accounts & blob storage — `server/` + `src/lib/blobs.ts`, `src/components/AuthGate.tsx`

`server/` is a Bun + Hono API (Postgres + Cloudflare R2). Accounts are email+password with an httpOnly session cookie; **signup locks after the first user** unless `ALLOW_SIGNUP=true`. `AuthGate` wraps `<App/>` in `main.tsx` so the editor's mount/autosave effects never run until logged in. **Critical blob rule:** the doc keeps images as data URLs *at runtime* (so `html-to-image` export never hits cross-origin canvas taint); R2 offload happens only at the storage boundary — `dehydrateDoc` (data URL → `blob:<id>` ref, uploaded to R2) on save, `hydrateDoc` (ref → data URL, streamed back through our same-origin API) on load. Never make `ThumbCanvas`/`export.ts` consume remote image URLs directly.

### The published document format — `scripts/gen-schema.ts` → `server/src/generated/thumbdoc.schema.json`

`src/state.ts` is the single source of truth; the JSON Schema is **generated** from it and committed. It lands under `server/` because docker-compose builds the api with context `./server` — the image cannot see `src/`. Served publicly at `GET /api/schema`.

`server/src/validate.ts` enforces it, and its design goal is *error quality*: `Layer` is a 7-branch `anyOf`, so validating the union wholesale buries the real problem under ~40 "must be equal to constant" lines. Instead it reads the discriminator (`type`, `preset`, `kind`) and runs only the matching branch, yielding `layers[3] (text): /size must be number`. A second, strict copy of the schema (`additionalProperties: false`) runs in parallel and reports unknown keys as non-fatal `warnings` — that's how a typo like `colour` becomes visible instead of silently ignored.

`THUMBDOC_VALIDATE=warn|enforce` gates rejection. **Validation on `PUT /api/projects/:id` is gated on `doc !== undefined`** — that endpoint doubles as rename, which sends `{ name }` only.

### Campaigns — one message across several platforms

A `campaigns` row plus a nullable `projects.campaign_id`: a **folder**, not a tag, so a design belongs to at most one campaign. `ON DELETE SET NULL` is deliberate — deleting a campaign must never destroy the designs in it; they fall back to "Senza campagna" in the archive.

The value is in `adaptDocToFormats` (`src/lib/adapt.ts`) + the `generate_campaign_set` MCP tool: compose once, then save one project per requested format. **`adaptDocToFormats` deep-clones each variant** because `adaptDocToFormat` only shallow-copies layers — without it, `bg`/`crop`/`points` would alias between designs that are supposed to be independent. `src/lib/adapt.test.ts` guards that.

`PUT /api/projects/:id` treats `campaignId` as tri-state: key absent = leave alone, `null` = unfile, id = file. `coalesce` can't express "set to null", so the column is only touched when the key is present. Campaign ownership is re-checked server-side (`resolveCampaign`) so a project can't be filed into another user's campaign.

### Agent access — `mcp/`, API tokens, `?project=` deep link

`mcp/` holds the tools once (`src/tools.ts`) and serves them over **two transports**: `src/stdio.ts` for local development, and `src/http.ts` — the hosted Streamable-HTTP endpoint at `/api/mcp` that the "Aggiungi MCP" button hands out. One implementation, so the two can't drift. It **imports `src/state.ts` and `src/presets.ts` directly** rather than duplicating them, so the agent gets the real layer factories and the real validator, and it pre-validates locally so schema mistakes cost no round trip.

The hosted endpoint is its own compose service, **built from the repo root** (`mcp/Dockerfile`) because unlike the api it genuinely needs `src/` as well as `server/src/`. It is stateless (`sessionIdGenerator: undefined`), holds no secrets, and never validates a token itself — it forwards the caller's bearer to `api`, which stays the single authority on auth. nginx routes `/api/mcp` to it; that works because nginx picks the **longest** matching prefix, so it wins over `/api/`. Don't add an explicit close after `handleRequest` — the body may still be streaming, and Hono's `executionCtx` is Workers-only and throws on Bun.

**A `doc` argument must publish `type: "object"`** — that's `docInput()` in `mcp/src/tools.ts`, and
it's load-bearing. With a bare `z.unknown()` the property carried no type in the generated JSON
Schema, and clients that infer argument types from it (Claude Code among them) sent the whole
document as a JSON *string*; every call died on `document must be an object`. The `preprocess` in
front still parses a stringified doc, for clients that stringify regardless.

The authoring rules live in `.claude/skills/thumb-studio/`.

Auth: `currentUser()` accepts the session cookie **or** `Authorization: Bearer tsk_…` backed by `api_tokens` (SHA-256 hash stored, never the plaintext). `/api/tokens*` is guarded by `requireCookieUser` — **a token must never be able to mint another token.**

`?project=<id>` on the editor URL opens that saved project instead of the IndexedDB working canvas, falling back gracefully if the id is stale. That's the loop-closer: the MCP server returns a link the user can open.

Symmetrically, every project tool in `mcp/src/tools.ts` takes its `id` through `projectIdFrom()`, which accepts a bare id **or** an editor URL carrying `?project=<id>` — the address bar is the thing users copy, so pasting it must work. A link with no `project` param is rejected with a usable message instead of being sent to the API as an id.

The param is also **written back**: an effect in `App.tsx` mirrors `projectId` into the query string (`replaceState`, gated on `hydrated` so it can't erase an incoming deep link before it loads). So the address bar always names the open project — shareable as-is, and a reload or new tab lands on the same design. `ProjectHeader`'s link icon copies that URL. Nothing else may strip the param on load.

### Deployment — `Dockerfile` (web/nginx), `server/Dockerfile` (api), `mcp/Dockerfile` (mcp), `docker-compose.yml`

One Compose unit: `web` (nginx serves `dist/`, proxies `/api` → `api` and `/api/mcp` → `mcp`, all same-origin), `api` (Bun), `mcp` (Bun, hosted MCP endpoint), `postgres`. Deployed on a VPS via Dokploy from this repo; secrets (`POSTGRES_PASSWORD`, `R2_*`, `APP_URL`, `ALLOW_SIGNUP`, `THUMBDOC_VALIDATE`) come from the Dokploy environment — see `.env.example`. Frontend calls the API at relative `/api`, so no build-time URL is needed.

Build contexts differ on purpose and are load-bearing: `api` is built from `./server` (small, no access to `src/`), while `web` and `mcp` are built from the repo root. `.dockerignore` excludes `**/node_modules`, not just the top-level one — the root context spans every package.

### Background removal — `src/lib/bgremove.ts`

One function, two backends chosen by build mode: **production** uses `@imgly/background-removal` (runs in-browser); **dev** POSTs to the local rembg FastAPI sidecar at `VITE_BGREMOVE_URL` (default `http://localhost:8000`). The pre-cutout image is preserved on the layer as `origSrc` so the operation is reversible ("Ripristina").

### Export — `src/lib/export.ts`

`html-to-image`'s `toPng` captures the canvas node at exactly 1280×720 (transform reset for the capture, then restored), triggers a download, and returns a warning string if the PNG exceeds YouTube's 2 MB limit.

## Conventions

- `src/components/ui/` are shadcn-style Radix primitives; compose them rather than adding new UI libraries. Styling is Tailwind v4 + `cn()` (`clsx` + `tailwind-merge`) in `src/lib/utils.ts`.
- Inline `// ponytail:` comments mark deliberate simplifications with their upgrade path — leave them.
- Coordinates are always in 1280×720 space (`CANVAS_W`/`CANVAS_H`), never screen pixels.
