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

The API's route tests (`server/src/app.test.ts`) need a Postgres and **skip themselves without
one**, so `check` stays green on a machine that has none:

```bash
docker run -d --name thumb-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=thumbtest \
  -p 55432:5432 postgres:16
DATABASE_URL=postgres://postgres:postgres@localhost:55432/thumbtest bun test server
```

They truncate every table, so the suite **refuses to run unless the database name contains
"test"** — never point `DATABASE_URL` at anything you care about. They also pin
`ALLOW_SIGNUP=false`, because bun auto-loads `.env` and a developer's has it on, which would
turn the "signup locks after the first user" test into a no-op.

CI (`.github/workflows/ci.yml`) runs exactly that on every push and PR — root `check`, then the
two package typechecks — plus a build of all three images. The image job exists because the
build contexts differ on purpose (api from `./server`, web and mcp from the repo root): a wrong
path there typechecks fine and only fails at deploy time. Nothing is pushed; Dokploy still owns
deploys.

**Any change to the layer/document types in `src/state.ts` requires `bun run schema`** and
committing the regenerated file, or `check` fails.

Background-removal sidecar (optional, dev only — see `bgremove/README.md`):

```bash
cd bgremove && docker build -t yt-thumb-bgremove . && docker run --rm -p 8000:8000 yt-thumb-bgremove
```

## Architecture

Single-page React editor for YouTube thumbnails (fixed 1280×720). No router, no global state library. Output is a PNG downloaded client-side. The UI strings are in **English** — match that when adding user-facing text. (The `dacoder` templates in `src/presets.ts` still carry Italian *design copy*: that's channel content, not UI.) There is now an optional backend (`server/`) for accounts + remote project storage; the editor itself is unchanged and still works fully client-side against IndexedDB for the live working canvas.

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

An image layer's border is a plain CSS border while it's a solid colour. A **gradient** border (and the optional blurred `ringGlow` copy behind the picture) is drawn instead by `RingSvg` — a stroked rounded rect in an inline `<svg>`, inset by half the stroke so it covers exactly the band the CSS border reserves, and sized in percentages so no path has to measure the box. It is *not* the usual `background-clip: border-box` + `mask-composite` trick: `html-to-image` re-serialises computed styles into a foreignObject and the mask does not survive, so exports came back with the gradient flooding the picture. A stroke has no middle to flood. Check any new edge treatment against an actual export, not just the canvas.

The cut-out outline (`glowStyle`) is a different problem — it follows the photo's alpha, not a box — so it's an SVG filter in `OutlineDefs`, one `feMorphology` dilate rather than a stack of drop-shadows. The `gradient` variant needs paint a filter graph can't make: `feFlood` is one colour and there is no gradient primitive. So the ramp arrives as a `feImage` pointing at an inline data-URI SVG, which does survive `html-to-image` (verified against a real export). `feImage` stretches that tile over the whole filter region, and the region is `GLOW_REGION`× the layer's box so the halo blur has room — hence the tile's gradient is squeezed to `1/GLOW_REGION`, or the picture would only ever show the middle of the ramp.

### Layer list — `src/components/LayerList.tsx`

The list paints **front-first** (row 0 = last layer in the array), and rows are drag-reorderable with hand-rolled pointer events (no dnd library). Two things follow from the inversion: the drop indicator is an absolutely-positioned overlay (inserting a real element between rows would shift the rows being measured), and a visual gap `slot` becomes a doc gap as `layers.length - slot` before it goes to the `moveLayers` action. `moveLayers` lifts the whole selection out keeping its relative order and reinserts it at that gap, rebasing the gap onto the lifted array so the block lands where the indicator was. Touch/pen must drag from the grip handle — dragging the row body is mouse-only, or a swipe could never scroll the rail. Selection modifiers are the platform-standard ones: plain click replaces, ⌘/Ctrl toggles a row, Shift extends from the last clicked row (group mates always come along).

### Persistence — `src/lib/storage.ts`

`storage.ts` is the single seam for all persistence, split by concern:
- **Local (IndexedDB, DB name `grocerai-thumb`)** — the autosaved `working` canvas + its project identity (store `meta`). Kept local so the live canvas is fast/offline and holds full base64 data URLs the canvas can paint. **Bumping the schema requires bumping `VERSION` and handling `onupgradeneeded`.**
- **Remote (backend API)** — named, reloadable projects (`listConfigs`/`loadConfig`/`saveConfig`/`renameConfig`/`deleteConfig` → `fetch('/api/...')` via `src/lib/api.ts`). The list returns metadata only (`ConfigMeta`); the full doc is fetched on open.
- Plus JSON file export/import (unchanged) so a project can leave the account.

### Backend, accounts & blob storage — `server/` + `src/lib/blobs.ts`, `src/components/AuthGate.tsx`

`server/` is a Bun + Hono API (Postgres + Cloudflare R2). Accounts are email+password with an httpOnly session cookie; **signup locks after the first user** unless `ALLOW_SIGNUP=true`. `AuthGate` wraps `<App/>` in `main.tsx` so the editor's mount/autosave effects never run until logged in. **Critical blob rule:** the doc keeps images as data URLs *at runtime* (so `html-to-image` export never hits cross-origin canvas taint); R2 offload happens only at the storage boundary — `dehydrateDoc` (data URL → `blob:<id>` ref, uploaded to R2) on save, `hydrateDoc` (ref → data URL, streamed back through our same-origin API) on load. Never make `ThumbCanvas`/`export.ts` consume remote image URLs directly.

### Archive previews — `src/lib/preview.ts` + `projects.preview`

Saving captures a ~320px JPEG of the canvas (`makePreview`) and stores it in the **same R2 blob store as the images**, referenced by a bare id instead of a `blob:` ref — so `SavesPanel` paints a real picture per row and two designs from one campaign stop being indistinguishable names. Three rules hold it together: the capture runs with the canvas rendered clean (`capturing` in `App.tsx` flips the same selection-hiding flag as export, kept separate so the Export button doesn't flash busy); `makePreview` **never throws**, because a save must not depend on a picture; and `preview` on `PUT /api/projects/:id` is `coalesce`d, not tri-state — a rename, or a save made with no canvas mounted (an agent's, `NewProjectDialog`'s save-then-create), keeps the last preview instead of blanking it. Projects an agent created have none and fall back to an icon; a real headless render would fill that gap.

### Reviewing a design, not just drawing it — `src/lib/safeAreas.ts`, `src/lib/readability.ts`

Editing happens at 40% of 1280px on a monitor; the design is seen at ~210px next to eleven others, with a duration pill over one corner. Three things close that gap, all view-only (they never touch the doc, and are hidden whenever `exporting` is set, which is what keeps them out of exports *and* previews):

- **`SAFE_ZONES`** — per-format boxes the platform paints over (`cover`) or crops away (`keep`), in canvas fractions. Rendered by `SafeAreaOverlay` in `ThumbCanvas`, toggled with **A**. Deliberately approximate: the point is "nothing important here", not a pixel-exact mock of a client that ships weekly.
- **`GRID_W`** — the width of the *smallest surface each format is really browsed at* (a grid cell, not a full-screen player). The **G** toggle sets the stage scale to it, so "actual size" is a fact rather than a zoom level. Same number drives the readability check, so the two can't disagree.
- **`checkReadability`** — pure, unit-tested (`readability.test.ts`): text too small at grid size, WCAG contrast under 3:1 against the pill/background (short-circuited by a thick stroke, since that settles it), layers under platform chrome or outside the crop, and word count. Geometry comes in pre-measured — how wide a run of text renders is a fact only the DOM has, so `ReadabilityPanel` measures `[data-layer-id]` nodes the same way the canvas does for snapping.

### The published document format — `scripts/gen-schema.ts` → `server/src/generated/thumbdoc.schema.json`

`src/state.ts` is the single source of truth; the JSON Schema is **generated** from it and committed. It lands under `server/` because docker-compose builds the api with context `./server` — the image cannot see `src/`. Served publicly at `GET /api/schema`.

`server/src/validate.ts` enforces it, and its design goal is *error quality*: `Layer` is a 7-branch `anyOf`, so validating the union wholesale buries the real problem under ~40 "must be equal to constant" lines. Instead it reads the discriminator (`type`, `preset`, `kind`) and runs only the matching branch, yielding `layers[3] (text): /size must be number`. A second, strict copy of the schema (`additionalProperties: false`) runs in parallel and reports unknown keys as non-fatal `warnings` — that's how a typo like `colour` becomes visible instead of silently ignored.

`THUMBDOC_VALIDATE=warn|enforce` gates rejection. **Validation on `PUT /api/projects/:id` is gated on `doc !== undefined`** — that endpoint doubles as rename, which sends `{ name }` only.

### Headless render — `render/` + `render.html` → `src/render.tsx`, `GET /api/projects/:id/render.png`

An agent composed documents blind: it could write layers and never see that two of them overlap. This is the loop-closer — `render_project` (MCP) returns an actual picture.

**One renderer, not two.** The design is HTML: text wrapping, font metrics, WebGL effect backgrounds, SVG glow filters are all the browser's work, and the editor's export is a screenshot of exactly that. A second renderer (satori, resvg, a canvas reimplementation) would be a second *opinion* about the design and would drift the first time anyone touched `ThumbCanvas`. So `render/` is a Chromium that loads `/render.html` — a second Vite entry mounting the real `ThumbCanvas` at scale 1, with no auth gate, no storage, no service worker — and screenshots `#stage`. It renders the **served** bundle over HTTP, so it can never be a stale copy of the canvas code.

The service is deliberately powerless: no database, no credentials, no knowledge of projects or users. `api` authenticates the caller, inlines the images (`hydrate.ts`, ownership checked per blob so a doc naming someone else's id resolves to nothing), and hands over a document. It is not routed by nginx; nothing outside the compose network can reach it.

Three things are load-bearing:
- **The base image tag and `playwright-core` version must move together** (`mcr.microsoft.com/playwright:v1.62.1-noble` ↔ `1.62.1`) — playwright refuses a browser build it doesn't recognise. CI builds this image for that reason.
- **`shm_size: 512mb`**, or Chromium dies mid-screenshot on the default 64 MB.
- `--use-angle=swiftshader`. The base image already resolves WebGL to SwiftShader without it (checked), but a Chromium with no GL context draws effect backgrounds as a **black rectangle with the layers fine on top**, and nothing throws. That's the first place to look if effects come back black.

One browser, one page, reused for the life of the process (boot + bundle load is far more than a render), with calls serialised — the page is stateless between renders because `__renderThumb` replaces the whole tree. A failed render closes the page so a crashed Chromium can't poison every later request. `RENDER_URL` unset ⇒ the route 503s with an explanation; the editor never needs it.

### Campaign export — `src/components/CampaignExporter.tsx` + `src/lib/zip.ts`

A campaign ends in uploading five files to five places, and the only way to get them was to open each design and press Export. `CampaignExporter` renders each design **offscreen** and captures it with the same `captureThumb` the Export button uses — so a YouTube variant that has to become a JPEG to fit 2 MB does so here too.

Offscreen means `position: fixed; left: -20000px`, **not `display: none`**: a hidden subtree has no layout, and the effect backgrounds are WebGL that needs a real canvas to draw into. Each design waits two frames plus `document.fonts.ready` before capture — the first frame paints layers, the second lets the effect canvases draw, and an unloaded webfont would otherwise capture as a fallback. Designs are fetched one at a time because a hydrated doc holds full-resolution images inline. One failing design is named in the summary instead of costing the other four.

`zip.ts` is a **stored** (uncompressed) ZIP writer, no dependency: PNGs and JPEGs are already compressed, so all that's left is a CRC and two header layouts. Its test writes an archive and hands it to the system `unzip -t` — the only check that proves the header layout is right rather than merely self-consistent.

### Schema migrations — `server/src/migrations.ts`

The schema is a **numbered list applied once each and recorded in `schema_migrations`**, not DDL re-run on every boot. The old `initSchema()` worked only as long as every change was expressible as `IF NOT EXISTS`; a rename, a one-time backfill or a tightened constraint has no such form, and nothing recorded what any given database had actually had done to it.

**Migration 001 is the entire pre-migrations schema, written idempotently** — so the deployed database applies it as a no-op (verified: all three apply cleanly over an existing schema, data intact) and a fresh one gets everything. From 002 on, migrations are ordinary DDL that runs exactly once.

Rules: **append, never renumber or edit an applied migration** — the record is what a deployed database has already done, and rewriting history makes the two disagree silently. One concern per migration. Duplicate or out-of-order ids throw at import, not at boot. Each runs in its own transaction so a failure leaves the database at the last complete step, and an advisory lock stops two containers starting at once from both applying the same one. TypeScript rather than `.sql` files: no statement splitter to get wrong on the first dollar-quoted string, and the migrations ship with the code however the image is built.

### Version history — `project_versions` + `HistoryDialog`

Undo is in-memory, 20 deep, and gone on reload, so an edit that survived a refresh used to be permanent — including one an agent made. Now every `PUT /api/projects/:id` that carries a `doc` files the **outgoing** document first (`snapshot()`), which is what makes the list read as "put it back to here" rather than as a log. Four rules: a save that didn't change the document files nothing (⌘S fires whether or not anything moved); a rename spends no version (it doesn't send `doc`); the window is capped at `VERSION_LIMIT = 30` per project, cheap because docs are stored dehydrated; and `snapshot()` never throws — losing a snapshot is regrettable, losing the save it was protecting is not. Restore is itself an edit, so it snapshots first and undoing a restore is another restore.

**The blob sweep must scan `project_versions`** (it does) — a restore that found its images collected would be worse than no history at all. Any future table holding a document has to be added there too.

### Guests & the public gallery — `/api/public/*`, `projects.is_public`, `AuthGate`

The site has a front door. A visitor with no credentials picks **Continue as a guest** and gets the whole editor over a read-only session: the designs the owner marked public, freedom to edit any of them, PNG/JPEG export and JSON export/import — and no way to write anything.

**A guest has no server-side identity.** No session row, no cookie, no token. Guest is a client-side state, which is what keeps the security argument short: the server never has to tell a guest from a stranger with curl, because they are the same caller. The only new surface is three `GET`s, and **no mutating endpoint was added or relaxed** — an unauthenticated caller cannot act like an authenticated one because there is no code path that would let them (`app.test.ts` asserts that route by route).

The three live under their own `/api/public` prefix, *not* as unguarded handlers inside `/api/projects`. Hono dispatches in registration order, so a public handler placed above the `app.use(…, requireUser)` block would bypass the guard **by position** — an invariant that survives until someone moves a line. A separate prefix says "no guard here" out loud.

- `GET /api/public/projects` — the gallery. Metadata only; no `user_id`, no private rows. It does expose the **campaign name** for grouping, which is owner-chosen text but is public.
- `GET /api/public/projects/:id` — one document. Private and absent answer identically, so the route never confirms a private id exists.
- `GET /api/public/projects/:pid/blobs/:bid` — image bytes, **scoped to the publishing project**. Nested rather than flat because blobs are content-addressed and shared between users: a flat route would have to prove "some public project references this id", i.e. scan every public document per image. Nesting makes it a primary-key lookup plus a containment test on one row. Two conditions, both required — the document must reference the id (or carry it as `preview`, which is how gallery thumbnails paint), **and** the publisher must own the blob, or a document naming someone else's id would lend out their bytes.

`projects.is_public` (migration 004) defaults to false, so everything already saved stays private and every project an agent creates does too. `POST /api/projects` deliberately doesn't read the key: publishing is only ever a `PUT`, and it's **presence-gated** like `campaignId` — `coalesce` can't set a column to false, so a value check would make unpublishing impossible, and a rename (which sends `{name}` only) can't quietly change it either.

Rate limiting: public reads count **every** request (`Limiter.hit`, not the login-shaped check/fail), on two buckets — 120/10min for lists and documents, 400/10min for bytes, since one design pulls several images. `POST /api/auth/register` and `/logout` got limiters for the same reason: a public landing page is an invitation to poke at them. nginx adds a `limit_req` zone on `/api/public/` so a flood dies before it costs a Bun worker.

Client side, `AuthGate` resolves one of three visitors before the editor mounts and is the only place that decides: it probes `/auth/me` first (a real session always beats a remembered guest flag), then sets **`setScope`** — which picks the IndexedDB key namespace *and* arms the read-only flag. Two things follow:

- **Guest and owner autosave into different keys** (`guest:working` vs `working`) in the same `meta` store — a prefix, deliberately not a second object store, so no `VERSION` bump or `onupgradeneeded` branch is needed. A guest's canvas can never overwrite the owner's on a shared browser.
- **Every mutating function in `storage.ts` and `uploadBlob` calls `assertWritable()`**, which throws before any `fetch`. That's what makes the UI sweep polish rather than correctness: a button missed during gating fires a local exception, not a request. `uploadBlob` matters specifically because it skips the `api.ts` wrapper and runs from the preview capture *before* a save.

A guest adopts an opened design with **`projectId: null`** — that is what the save path and the URL mirror treat as ownership, so a guest holds a local copy and the editor can't pretend otherwise. The `?project=` mirror effect is therefore **skipped in guest mode**, or it would strip the very deep link they arrived on.

### Hardening & housekeeping — `server/src/ratelimit.ts`, `server/src/maintenance.ts`

`POST /api/auth/login` is rate-limited on two sliding windows: per (address, account) so a targeted guess stalls at 8 tries per 10 minutes, and per address so walking a list of emails stalls at 40. **Only failures count and a success resets** — otherwise a busy legitimate user locks themselves out. The check runs *before* the password comparison, since not paying for the guess is the whole point. Counters are an in-memory `Map` (single API container; a restart forgives everyone) and the limiter is pure apart from an injectable clock, which is what makes `ratelimit.test.ts` possible without sleeping.

`Limiter.hit()` is check-and-record in one step, for limits where the request itself is the cost rather than a failed guess. A refused hit is **not** recorded, so hammering a closed window doesn't push its own reopening further away. The route tests give each helper call its own `x-real-ip`, because the limiters are module state shared by the whole file and the suite would otherwise throttle itself around the tenth registration.

Two sweeps run every six hours, started only under `import.meta.main` so importing the app in a test schedules nothing: expired sessions (previously deleted only on explicit logout, so they accumulated forever), and unreferenced R2 blobs (deleting a project dropped the row and left the bytes paying rent). **The blob sweep is built to under-delete**: a 24h grace period, because an image is uploaded *before* the project that references it is saved; a reference scan that matches any 64-hex run in the raw document JSON, so a field it doesn't know about still counts; and dry-run by default — `BLOB_GC=enforce` arms it, mirroring `THUMBDOC_VALIDATE`. The R2 object goes only when the last owner's row is gone, since blobs are content-addressed and shared.

`GET /api/health` runs `SELECT 1` and 503s if it can't — returning ok while Postgres is down is how an orchestrator keeps a broken container in rotation.

### Campaigns — one message across several platforms

A `campaigns` row plus a nullable `projects.campaign_id`: a **folder**, not a tag, so a design belongs to at most one campaign. `ON DELETE SET NULL` is deliberate — deleting a campaign must never destroy the designs in it; they fall back to "No campaign" in the archive.

The value is in `adaptDocToFormats` (`src/lib/adapt.ts`) + the `generate_campaign_set` MCP tool: compose once, then save one project per requested format. **`adaptDocToFormats` deep-clones each variant** because `adaptDocToFormat` only shallow-copies layers — without it, `bg`/`crop`/`points` would alias between designs that are supposed to be independent. `src/lib/adapt.test.ts` guards that.

`PUT /api/projects/:id` treats `campaignId` as tri-state: key absent = leave alone, `null` = unfile, id = file. `coalesce` can't express "set to null", so the column is only touched when the key is present. Campaign ownership is re-checked server-side (`resolveCampaign`) so a project can't be filed into another user's campaign.

### Agent access — `mcp/`, API tokens, `?project=` deep link

`mcp/` holds the tools once (`src/tools.ts`) and serves them over **two transports**: `src/stdio.ts` for local development, and `src/http.ts` — the hosted Streamable-HTTP endpoint at `/api/mcp` that the **Settings › MCP** panel hands out. One implementation, so the two can't drift. It **imports `src/state.ts` and `src/presets.ts` directly** rather than duplicating them, so the agent gets the real layer factories and the real validator, and it pre-validates locally so schema mistakes cost no round trip.

The hosted endpoint is its own compose service, **built from the repo root** (`mcp/Dockerfile`) because unlike the api it genuinely needs `src/` as well as `server/src/`. It is stateless (`sessionIdGenerator: undefined`), holds no secrets, and never validates a token itself — it forwards the caller's bearer to `api`, which stays the single authority on auth. nginx routes `/api/mcp` to it; that works because nginx picks the **longest** matching prefix, so it wins over `/api/`. Don't add an explicit close after `handleRequest` — the body may still be streaming, and Hono's `executionCtx` is Workers-only and throws on Bun.

Three tools exist because the agent surface had holes the editor didn't: `upload_image` (base64 → `POST /api/blobs` → a `blob:<id>` ref, the only way an agent can put a real photo in a design — capped at 8 MB here because a base64 argument is ~33% larger than the bytes and the transport, not the API, is the bottleneck), and `list_starred_elements` / `get_starred_element` / `add_starred_element`, which reach the user's favourites — the logo lockup and title treatments that *are* the channel's visual language, and which an agent otherwise reinvents badly each time. `add_starred_element` re-ids and `detachLayer`s before appending, or the copy collides with its original. `detachLayer` and `newLayerId` therefore live in `src/state.ts`, not `storage.ts`: document-model logic the MCP server needs without importing a module full of browser `fetch`.

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

One function, two backends chosen by build mode: **production** uses `@imgly/background-removal` (runs in-browser); **dev** POSTs to the local rembg FastAPI sidecar at `VITE_BGREMOVE_URL` (default `http://localhost:8000`). The pre-cutout image is preserved on the layer as `origSrc` so the operation is reversible ("Restore").

### Export — `src/lib/export.ts`

`html-to-image` captures the canvas node at exactly the doc's format size (transform reset for the capture, then restored) and triggers a download. When the platform has a hard limit and the PNG misses it, `fitToLimit` walks a JPEG quality ladder (0.92 → 0.55) and ships the best one that fits — "too big, simplify your background" was true and useless, since the fix is a file format, not a design change. The encoder is injected, so the ladder is unit-tested without a DOM; when even the floor is too big it returns the *smallest* attempt and the caller warns, because downloading something beats downloading nothing. `fileNameFor` keeps the extension honest.

## Conventions

- `src/components/ui/` are shadcn-style Radix primitives; compose them rather than adding new UI libraries. Styling is Tailwind v4 + `cn()` (`clsx` + `tailwind-merge`) in `src/lib/utils.ts`.
- Inline `// ponytail:` comments mark deliberate simplifications with their upgrade path — leave them.
- Coordinates are always in 1280×720 space (`CANVAS_W`/`CANVAS_H`), never screen pixels.
