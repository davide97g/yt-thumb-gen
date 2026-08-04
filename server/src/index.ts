// yt-thumb-gen backend — Bun + Hono.
//
// Serves the /api surface consumed by the SPA (which nginx proxies same-origin, so no
// CORS here). Auth is a **Clerk** session — Google sign-in, verified per request from the
// `__session` cookie the browser holds same-origin (see clerk.ts / identity.ts) — plus this
// application's own `tsk_` bearer tokens for agents. There is no password here any more, and
// no local session table: `/auth/login`, `/auth/register`, `/auth/logout` and the `sessions`
// table are all gone (migration 009).
// Named projects live in Postgres; image bytes live in R2 (content-addressed).

import { Hono } from "hono";
import { clerkConfigured, verifyClerkRequest } from "./clerk";
import { initSchema, sql } from "./db";
import { hydrateDocForRender } from "./hydrate";
import { auditAllowlist, resolveClerkUser, type User } from "./identity";
import { startMaintenance } from "./maintenance";
import { getBlob, putBlob } from "./r2";
import { createLimiter, type Limiter } from "./ratelimit";
import { MODE, docWarnings, schema as docSchema, validateDoc, validateLayer } from "./validate";

await initSchema();
// Reports an account whose address the allowlist doesn't admit — the one way this migration
// can go quietly wrong. Not awaited: it is a diagnostic, and a boot must not wait on it.
void auditAllowlist().catch(() => {});

// ── helpers ───────────────────────────────────────────────────────────────

const app = new Hono<{ Variables: { user: User } }>();

function newToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const sha256 = async (s: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (x) =>
    x.toString(16).padStart(2, "0")
  ).join("");

/** Identity from the browser's Clerk session.
 *
 *  Three outcomes, and the middle one is why this doesn't just return `User | null`:
 *  `"denied"` is a verified Google account this deployment will not serve, which the front
 *  door has to be able to say out loud — the alternative is signing someone in to an editor
 *  whose every save 401s. */
async function sessionUser(c: any): Promise<User | "denied" | null> {
  const identity = await verifyClerkRequest(c.req.raw);
  return identity ? await resolveClerkUser(identity) : null;
}

/** How stale `api_tokens.last_used_at` is allowed to be. The column answers "is this token
 *  still in use", which a minute's resolution answers just as well as a write per request —
 *  and an agent working through a document makes a lot of requests. */
const TOKEN_STAMP_MS = 60_000;
/** hash → when we last stamped it. Only ever holds hashes that matched a real token, so its
 *  size is bounded by the table rather than by whatever a caller sends. */
const lastStamped = new Map<string, number>();

/** Identity from an `Authorization: Bearer tsk_…` personal API token. nginx forwards the
 *  header untouched, so this works the same behind the proxy as it does locally. */
async function bearerUser(c: any): Promise<User | null> {
  const header = c.req.header("authorization");
  const raw = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!raw) return null;
  // Hashed once. This ran twice per request — the lookup and the usage stamp each did their
  // own SHA-256 of the same string.
  const hash = await sha256(raw);
  const rows = await sql<User[]>`
    SELECT u.id, u.email FROM api_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ${hash}`;
  const user = rows[0];
  if (!user) return null;
  // Best-effort usage stamp; never block the request on it, and never more than once a minute.
  const now = Date.now();
  if (now - (lastStamped.get(hash) ?? 0) > TOKEN_STAMP_MS) {
    lastStamped.set(hash, now);
    sql`UPDATE api_tokens SET last_used_at = now() WHERE token_hash = ${hash}`.catch(() => {});
  }
  return user;
}

/** The caller, however they identify: a Clerk session or a `tsk_` personal token. `"denied"`
 *  propagates so the guards can answer 403 rather than 401 — see `sessionUser`. */
async function currentUser(c: any): Promise<User | "denied" | null> {
  const session = await sessionUser(c);
  if (session) return session;
  return await bearerUser(c);
}

/** Blob ids are the sha-256 of their bytes, so they have exactly one shape. Checking it up
 *  front rejects junk before it reaches a query, and — on the public blob route — guarantees
 *  the value carries no `LIKE` wildcard. */
const isBlobId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

// There is no password to guess here any more — Clerk holds the credential, and the brute-force
// windows that used to defend `/auth/login` left with it. What remains reachable without
// credentials is `/auth/me`, and an unverified call to it is cheap but not free: a malformed
// token still costs a signature check. Generous, therefore: this bounds a cost, it doesn't
// defend a secret.
const perAddressMe = createLimiter({ limit: 120, windowMs: 10 * 60_000 });

// Public reads. Every request counts here (`hit`, not `check`/`fail`) because there is no
// success/failure distinction to exploit — the request itself is the cost. Two buckets: one
// design pulls a handful of images, so bounding both with one number would either starve a
// legitimate gallery visit or leave the expensive path wide open.
const perAddressPublic = createLimiter({ limit: 120, windowMs: 10 * 60_000 });
const perAddressPublicBlob = createLimiter({ limit: 400, windowMs: 10 * 60_000 });

/** Caller's address as nginx reports it (see nginx.conf, which sets both headers). Falls back
 *  to a constant, so a direct-to-Bun deployment degrades to a single global bucket rather
 *  than to no limit at all. */
function clientIp(c: any): string {
  return c.req.header("x-real-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Charges one request to the caller's address. Returns the 429 to send, or null to carry on.
 *  Every remaining limiter is this shape: the request itself is the cost, so it counts whether
 *  or not it succeeded. (`ratelimit.ts` still carries the check/fail/reset trio — only-failures-
 *  count, success-resets — which is what a credential guess needs. Nothing here guesses a
 *  credential any more; Clerk holds the one there is.) */
function throttle(c: any, limiter: Limiter): Response | null {
  const verdict = limiter.hit(clientIp(c));
  if (verdict.ok) return null;
  return Response.json(
    { error: "Too many requests. Try again shortly." },
    { status: 429, headers: { "retry-after": String(Math.ceil(verdict.retryAfterMs / 1000)) } }
  );
}

// Runs the document contract. In `warn` mode a bad doc is logged and still stored, so the
// rule can be observed against real traffic before it starts turning saves into failures;
// in `enforce` mode it 422s. `details` is what an agent reads to correct itself.
function docProblems(where: string, errors: string[]): Response | null {
  if (errors.length === 0) return null;
  console.warn(`[thumbdoc:${MODE}] ${where}`, errors.slice(0, 10));
  if (MODE !== "enforce") return null;
  return Response.json({ error: "Invalid document", details: errors.slice(0, 50) }, { status: 422 });
}

// ── auth ─────────────────────────────────────────────────────────────────
//
// Two routes, and neither of them holds a credential. Signing in and out are Clerk's, in the
// browser: there is nothing for this API to issue, so there is nothing for it to leak.

/** What the front door needs to know before it draws itself: whether this deployment can
 *  authenticate anyone at all. A "Continue with Google" button on an instance with no
 *  `CLERK_SECRET_KEY` fails in a way that looks like a broken product rather than an
 *  unconfigured one. No database, no credential — safe to answer for strangers. */
app.get("/api/auth/status", (c) => c.json({ clerk: clerkConfigured() }));

app.get("/api/auth/me", async (c) => {
  const limited = throttle(c, perAddressMe);
  if (limited) return limited;
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  // 403, not 401: the credential is *valid*, the account simply isn't welcome here. The
  // difference is the whole message — "sign in" versus "this Google account has no access" —
  // and only the server knows which one is true.
  if (user === "denied") return c.json({ error: "This account does not have access to this workspace." }, 403);
  return c.json({ id: user.id, email: user.email });
});

// ── public reads (no credentials, by design) ────────────────────────────────
//
// The front door for a visitor with no account: the designs the owner has explicitly marked
// public, and nothing else. Three GETs, no body accepted anywhere, no write of any kind — so
// "a guest cannot act like an authenticated user" isn't a check somewhere, it's the absence
// of a code path.
//
// They live under their own `/api/public` prefix rather than as unguarded handlers inside
// `/api/projects`. Hono dispatches in registration order, so a public handler placed above
// the `app.use(…, requireUser)` block would bypass the guard *by position* — an invariant
// that survives exactly until someone moves a line. A separate prefix says "no guard here"
// out loud, and can't be undone by reordering.

app.get("/api/public/projects", async (c) => {
  const limited = throttle(c, perAddressPublic);
  if (limited) return limited;
  // Note what isn't selected: user_id, campaign_id, and every row where is_public is false.
  // The campaign *name* is exposed, for grouping — owner-chosen text, but exposed.
  const rows = await sql`
    SELECT p.id, p.name, p.preview, p.format, c.name AS "campaignName",
      (extract(epoch from p.updated_at) * 1000)::float8 AS "updatedAt"
    FROM projects p LEFT JOIN campaigns c ON c.id = p.campaign_id
    WHERE p.is_public ORDER BY p.updated_at DESC`;
  return c.json(rows);
});

app.get("/api/public/projects/:id", async (c) => {
  const limited = throttle(c, perAddressPublic);
  if (limited) return limited;
  const rows = await sql`
    SELECT id, name, doc, (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"
    FROM projects WHERE id = ${c.req.param("id")} AND is_public`;
  // Absent and private answer identically, so the route never confirms that a private id exists.
  if (!rows[0]) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

// Image bytes, scoped to the project that publishes them — which is why the route is nested
// rather than a flat /api/public/blobs/:id. Blobs are content-addressed and shared between
// users, so a flat route would have to prove "some public project references this id", i.e.
// scan every public document on every image request. Nesting turns that into a primary-key
// lookup plus a containment test on one row.
app.get("/api/public/projects/:pid/blobs/:bid", async (c) => {
  const limited = throttle(c, perAddressPublicBlob);
  if (limited) return limited;
  const bid = c.req.param("bid");
  if (!isBlobId(bid)) return c.json({ error: "not found" }, 404);
  const [row] = await sql<{ ok: boolean; content_type: string | null }[]>`
    SELECT (p.preview = ${bid} OR p.doc::text LIKE ${"%" + bid + "%"}) AS ok, b.content_type
    FROM projects p LEFT JOIN blobs b ON b.id = ${bid} AND b.user_id = p.user_id
    WHERE p.id = ${c.req.param("pid")} AND p.is_public`;
  // Two conditions, both required. `ok` says the public document actually references these
  // bytes (the `preview =` arm is what lets the gallery paint its thumbnails through this
  // same route); `content_type` comes from the ownership row and being null means the
  // publisher doesn't own the blob — a document naming someone else's id resolves to nothing,
  // the same rule hydrate.ts applies for the authenticated render path.
  if (!row?.ok || !row.content_type) return c.json({ error: "not found" }, 404);
  const bytes = await getBlob(bid);
  if (!bytes) return c.json({ error: "not found" }, 404);
  return new Response(bytes, {
    // Content-addressed bytes never change, so repeat views cost the browser cache, not R2.
    headers: { "content-type": row.content_type, "cache-control": "public, max-age=31536000, immutable" },
  });
});

// ── auth guard for everything below ─────────────────────────────────────────
app.use("/api/projects/*", requireUser);
app.use("/api/projects", requireUser);
app.use("/api/blobs/*", requireUser);
app.use("/api/blobs", requireUser);
app.use("/api/starred/*", requireUser);
app.use("/api/starred", requireUser);
app.use("/api/campaigns/*", requireUser);
app.use("/api/campaigns", requireUser);
// Token management requires a real sign-in on purpose: a token must not be able to mint
// another token, so a leaked token cannot be used to entrench itself.
app.use("/api/tokens/*", requireSessionUser);
app.use("/api/tokens", requireSessionUser);

/** 401 when there is no credential, 403 when there is one this workspace won't serve. Shared
 *  by both guards, because the distinction is the same wherever it is drawn. */
function refuse(c: any, user: "denied" | null) {
  if (user === "denied") return c.json({ error: "This account does not have access to this workspace." }, 403);
  return c.json({ error: "unauthorized" }, 401);
}

async function requireUser(c: any, next: () => Promise<void>) {
  const user = await currentUser(c);
  if (!user || user === "denied") return refuse(c, user);
  c.set("user", user);
  return next();
}

/** A Clerk session only — never a `tsk_` token. Same rule as before under a truer name: what
 *  matters is that the caller is a signed-in human at the keyboard, not which cookie carries it. */
async function requireSessionUser(c: any, next: () => Promise<void>) {
  const user = await sessionUser(c);
  if (!user || user === "denied") return refuse(c, user);
  c.set("user", user);
  return next();
}

// ── projects ────────────────────────────────────────────────────────────────
//
// Timestamps go out as epoch ms. The ::float8 cast matters: `extract(epoch …)` is
// numeric, and postgres.js maps numeric to a *string* to protect precision, so the
// client would receive "1753…" and `new Date(that)` yields Invalid Date. float8
// arrives as a real JS number.
app.get("/api/projects", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name, campaign_id AS "campaignId", format, preview, is_public AS "isPublic",
      (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"
    FROM projects WHERE user_id = ${user.id} ORDER BY updated_at DESC`;
  return c.json(rows);
});

app.get("/api/projects/:id", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name, doc, campaign_id AS "campaignId", is_public AS "isPublic",
      (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"
    FROM projects WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  if (!rows[0]) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

/** A preview is a blob id, i.e. the sha-256 of the stored bytes. Anything else is dropped
 *  rather than rejected: a bad preview must never cost the user their save. */
const previewOr = (value: unknown, fallback: string | null): string | null => (isBlobId(value) ? value : fallback);

/** The document's format, for the denormalised `projects.format` / `project_versions.format`
 *  column (migrations 005/006). Every write that stores a `doc` must also write this, or the
 *  archive would label rows from a document it no longer holds — so it lives here rather than
 *  being spelled out at each call site. Not validated against the format list on purpose: the
 *  document contract owns that, and in `warn` mode a doc with a junk format is still stored,
 *  in which case the column should say the same junk the document does. */
const formatOf = (doc: unknown): string | null => {
  const value = (doc as { format?: unknown } | null)?.format;
  return typeof value === "string" ? value : null;
};

/** Resolves a caller-supplied campaign id to something safe to store. Returns `false` when
 *  the campaign isn't the caller's, so a project can never be filed into someone else's. */
async function resolveCampaign(userId: string, value: unknown): Promise<string | null | false> {
  if (value === null) return null;
  if (typeof value !== "string" || !value) return false;
  const rows = await sql`SELECT id FROM campaigns WHERE id = ${value} AND user_id = ${userId}`;
  return rows[0] ? value : false;
}

/** How many past documents a project keeps. Docs are stored dehydrated (images are refs, not
 *  bytes), so a version is a few kilobytes of JSON — 30 of them cost less than one photo. */
const VERSION_LIMIT = 30;

/** Files a project's current document as a version, ahead of `incoming` replacing it.
 *
 *  Skips when nothing changed: the editor saves on ⌘S whether or not anything moved, and a
 *  history of twenty identical entries is a history of nothing. Never throws — losing a
 *  snapshot is regrettable, losing the save it was protecting is not. */
async function snapshot(userId: string, projectId: string, incoming: unknown): Promise<void> {
  try {
    const [current] = await sql<{ name: string; same: boolean }[]>`
      SELECT name, doc = ${sql.json(incoming as any)}::jsonb AS same
      FROM projects WHERE id = ${projectId} AND user_id = ${userId}`;
    if (!current || current.same) return;

    // `format` comes off the column, not the document — it is already the same fact. The layer
    // count is computed here instead, because nothing else needed it before now; it is the one
    // place the document is opened, and this statement was reading `doc` anyway.
    await sql`
      INSERT INTO project_versions (project_id, user_id, name, doc, format, layer_count)
      SELECT id, user_id, name, doc, format,
        CASE WHEN jsonb_typeof(doc->'layers') = 'array' THEN jsonb_array_length(doc->'layers') ELSE NULL END
      FROM projects WHERE id = ${projectId} AND user_id = ${userId}`;

    // Keep the window bounded per project rather than sweeping globally later.
    await sql`
      DELETE FROM project_versions WHERE project_id = ${projectId} AND id NOT IN (
        SELECT id FROM project_versions WHERE project_id = ${projectId}
        ORDER BY created_at DESC LIMIT ${VERSION_LIMIT}
      )`;
  } catch (err) {
    console.warn("[versions] snapshot failed", err);
  }
}

// Note what this does *not* read: `isPublic`. A new project is always private — publishing is
// a separate act (PUT), never a side effect of a save, which is what keeps every project an
// agent creates out of the public gallery by default.
app.post("/api/projects", async (c) => {
  const user = c.get("user") as User;
  const { name, doc, campaignId, preview } = await c.req.json().catch(() => ({}));
  if (typeof name !== "string" || typeof doc !== "object" || doc === null) return c.json({ error: "bad request" }, 400);
  const rejected = docProblems("POST /projects", validateDoc(doc));
  if (rejected) return rejected;
  const campaign = campaignId === undefined ? null : await resolveCampaign(user.id, campaignId);
  if (campaign === false) return c.json({ error: "Campaign not found" }, 404);
  const [row] = await sql`
    INSERT INTO projects (user_id, name, doc, campaign_id, preview, format)
    VALUES (${user.id}, ${name}, ${sql.json(doc)}, ${campaign}, ${previewOr(preview, null)}, ${formatOf(doc)})
    RETURNING id, name, campaign_id AS "campaignId", preview, format, is_public AS "isPublic",
      (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"`;
  return c.json({ ...row, warnings: docWarnings(doc) });
});

app.put("/api/projects/:id", async (c) => {
  const user = c.get("user") as User;
  const body = await c.req.json().catch(() => ({}));
  const { name, doc } = body;
  // Gate on `doc !== undefined`: this endpoint doubles as rename, which sends { name } only
  // (see renameConfig in src/lib/storage.ts). Validating unconditionally would break it.
  if (doc !== undefined) {
    const rejected = docProblems("PUT /projects", validateDoc(doc));
    if (rejected) return rejected;
    // File the outgoing document before it's overwritten. Snapshotting the *previous* state
    // is what makes the history a list of "put it back here" points rather than a log.
    await snapshot(user.id, c.req.param("id"), doc);
  }
  // Tri-state: key absent = leave the campaign alone, null = unfile, id = file. `coalesce`
  // can't express "set to null", so the column is only touched when the key is present.
  const hasCampaign = "campaignId" in body;
  const campaign = hasCampaign ? await resolveCampaign(user.id, body.campaignId) : null;
  if (campaign === false) return c.json({ error: "Campaign not found" }, 404);
  // Same presence gate for the publish flag, and for the same reason: `coalesce` can't set a
  // column to false, so unpublishing would be impossible if this were a value check. It also
  // means an ordinary save or a rename — neither of which sends the key — can never quietly
  // publish a design or take a published one down.
  const hasPublic = "isPublic" in body;
  // No tri-state for the preview: a request that omits it (a rename, or a save made with no
  // canvas mounted) keeps the last one, which is closer to the truth than blanking the row.
  //
  // `format` is presence-gated on the document rather than coalesced, because that column has
  // to agree with what was just stored: a rename sends no doc and leaves it alone, while a save
  // always restates it — so a format change lands, and a document that arrives without one
  // can't leave a stale label behind. (app.test.ts pins all three cases.)
  const [row] = await sql`
    UPDATE projects SET
      name = coalesce(${name ?? null}, name),
      doc = coalesce(${doc === undefined ? null : sql.json(doc)}, doc),
      preview = coalesce(${previewOr(body.preview, null)}, preview),
      campaign_id = ${hasCampaign ? campaign : sql`campaign_id`},
      is_public = ${hasPublic ? body.isPublic === true : sql`is_public`},
      format = ${doc === undefined ? sql`format` : formatOf(doc)},
      updated_at = now()
    WHERE id = ${c.req.param("id")} AND user_id = ${user.id}
    RETURNING id, name, campaign_id AS "campaignId", preview, format, is_public AS "isPublic",
      (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"`;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.delete("/api/projects/:id", async (c) => {
  const user = c.get("user") as User;
  await sql`DELETE FROM projects WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  return c.json({ ok: true });
});

// ── server-side render ──────────────────────────────────────────────────────
//
// A picture of a design, for anything that can't run a browser: an agent checking its own
// work, a preview for a project nobody has opened, a link unfurl. Optional — with RENDER_URL
// unset the route says so instead of 500ing, and the editor never needs it.
const RENDER_URL = process.env.RENDER_URL;

app.get("/api/projects/:id/render.png", async (c) => {
  const user = c.get("user") as User;
  if (!RENDER_URL) return c.json({ error: "Rendering is not enabled on this deployment (RENDER_URL unset)." }, 503);

  const [row] = await sql<{ doc: unknown }[]>`
    SELECT doc FROM projects WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  if (!row) return c.json({ error: "not found" }, 404);

  try {
    // Images are inlined here, not fetched by the renderer: it holds no credentials and is
    // never handed any, so it can only draw what it is given.
    const doc = await hydrateDocForRender(row.doc, user.id);
    const res = await fetch(`${RENDER_URL}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc }),
    });
    if (!res.ok) {
      console.warn("[render] service replied", res.status, await res.text().catch(() => ""));
      return c.json({ error: "Render failed" }, 502);
    }
    return new Response(await res.arrayBuffer(), {
      // No caching: the document can change between two requests for the same id.
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (err) {
    console.warn("[render] unreachable", err);
    return c.json({ error: "Render service unreachable" }, 502);
  }
});

// ── version history ─────────────────────────────────────────────────────────
//
// Every route here is scoped by user_id as well as project_id. The version id alone is not a
// capability: guessing one must not read another account's design.
app.get("/api/projects/:id/versions", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name, (extract(epoch from created_at) * 1000)::float8 AS "createdAt",
      layer_count AS "layerCount", format
    FROM project_versions WHERE project_id = ${c.req.param("id")} AND user_id = ${user.id}
    ORDER BY created_at DESC`;
  return c.json(rows);
});

app.get("/api/projects/:id/versions/:versionId", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name, doc, (extract(epoch from created_at) * 1000)::float8 AS "createdAt"
    FROM project_versions
    WHERE id = ${c.req.param("versionId")} AND project_id = ${c.req.param("id")} AND user_id = ${user.id}`;
  if (!rows[0]) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

// Restoring is itself an edit, so the document being replaced is filed first — undoing a
// restore is just another restore.
app.post("/api/projects/:id/versions/:versionId/restore", async (c) => {
  const user = c.get("user") as User;
  const id = c.req.param("id");
  const [version] = await sql<{ doc: unknown }[]>`
    SELECT doc FROM project_versions
    WHERE id = ${c.req.param("versionId")} AND project_id = ${id} AND user_id = ${user.id}`;
  if (!version) return c.json({ error: "not found" }, 404);

  await snapshot(user.id, id, version.doc);
  // A restore replaces the document, so it restates `format` for the same reason a save does.
  const [row] = await sql`
    UPDATE projects SET doc = ${sql.json(version.doc as any)}, format = ${formatOf(version.doc)}, updated_at = now()
    WHERE id = ${id} AND user_id = ${user.id}
    RETURNING id, name, campaign_id AS "campaignId", preview, format, (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"`;
  if (!row) return c.json({ error: "not found" }, 404);
  // The preview column still shows the design that was just replaced; it refreshes on the
  // next save from the editor. Better a stale thumbnail than a blank row.
  return c.json({ ...row, doc: version.doc });
});

// ── campaigns (a folder of designs: one message across several platforms) ────
app.get("/api/campaigns", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT c.id, c.name,
      (extract(epoch from c.updated_at) * 1000)::float8 AS "updatedAt",
      count(p.id)::int AS "designCount"
    FROM campaigns c LEFT JOIN projects p ON p.campaign_id = c.id
    WHERE c.user_id = ${user.id}
    GROUP BY c.id ORDER BY c.updated_at DESC`;
  return c.json(rows);
});

app.get("/api/campaigns/:id", async (c) => {
  const user = c.get("user") as User;
  const id = c.req.param("id");
  const rows = await sql`
    SELECT id, name, (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"
    FROM campaigns WHERE id = ${id} AND user_id = ${user.id}`;
  if (!rows[0]) return c.json({ error: "not found" }, 404);
  // Metadata only, like the project list — the docs are fetched one at a time.
  const designs = await sql`
    SELECT id, name, format, preview,
      (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"
    FROM projects WHERE campaign_id = ${id} AND user_id = ${user.id}
    ORDER BY updated_at DESC`;
  return c.json({ ...rows[0], designs });
});

app.post("/api/campaigns", async (c) => {
  const user = c.get("user") as User;
  const { name } = await c.req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) return c.json({ error: "bad request" }, 400);
  const [row] = await sql`
    INSERT INTO campaigns (user_id, name) VALUES (${user.id}, ${name.trim()})
    RETURNING id, name, (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"`;
  return c.json({ ...row, designCount: 0 });
});

app.put("/api/campaigns/:id", async (c) => {
  const user = c.get("user") as User;
  const { name } = await c.req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) return c.json({ error: "bad request" }, 400);
  const [row] = await sql`
    UPDATE campaigns SET name = ${name.trim()}, updated_at = now()
    WHERE id = ${c.req.param("id")} AND user_id = ${user.id}
    RETURNING id, name, (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"`;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

// Deleting a campaign never deletes its designs — `projects.campaign_id` is ON DELETE SET
// NULL, so they simply return to the ungrouped list.
app.delete("/api/campaigns/:id", async (c) => {
  const user = c.get("user") as User;
  await sql`DELETE FROM campaigns WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  return c.json({ ok: true });
});

// ── personal API tokens (Clerk session only; see the guard above) ───────────
app.get("/api/tokens", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name,
      (extract(epoch from created_at) * 1000)::float8 AS "createdAt",
      (extract(epoch from last_used_at) * 1000)::float8 AS "lastUsedAt"
    FROM api_tokens WHERE user_id = ${user.id} ORDER BY created_at DESC`;
  return c.json(rows);
});

// The plaintext token is returned exactly once, here. After this only its hash exists.
app.post("/api/tokens", async (c) => {
  const user = c.get("user") as User;
  const { name } = await c.req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) return c.json({ error: "bad request" }, 400);
  const token = `tsk_${newToken()}`;
  const [row] = await sql`
    INSERT INTO api_tokens (user_id, name, token_hash) VALUES (${user.id}, ${name.trim()}, ${await sha256(token)})
    RETURNING id, name, (extract(epoch from created_at) * 1000)::float8 AS "createdAt"`;
  return c.json({ ...row, token });
});

app.delete("/api/tokens/:id", async (c) => {
  const user = c.get("user") as User;
  await sql`DELETE FROM api_tokens WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  return c.json({ ok: true });
});

// ── starred elements (single layers saved into a per-user collection) ────────
app.get("/api/starred", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name, kind, source_project_id AS "sourceProjectId", source_project_name AS "sourceProjectName",
      (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt",
      (extract(epoch from coalesce(last_used_at, updated_at)) * 1000)::float8 AS "lastUsedAt"
    FROM starred_items WHERE user_id = ${user.id} ORDER BY coalesce(last_used_at, updated_at) DESC`;
  return c.json(rows);
});

app.get("/api/starred/:id", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name, kind, layer, source_project_id AS "sourceProjectId", source_project_name AS "sourceProjectName",
      (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt",
      (extract(epoch from coalesce(last_used_at, updated_at)) * 1000)::float8 AS "lastUsedAt"
    FROM starred_items WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  if (!rows[0]) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

app.post("/api/starred", async (c) => {
  const user = c.get("user") as User;
  const { name, kind, layer, sourceProjectId, sourceProjectName } = await c.req.json().catch(() => ({}));
  if (typeof name !== "string" || typeof kind !== "string" || typeof layer !== "object" || layer === null) {
    return c.json({ error: "bad request" }, 400);
  }
  // Starred items store a bare Layer, so they're held to the same contract as a layer inside
  // a doc — otherwise the format would be only half-enforced.
  const rejected = docProblems("POST /starred", validateLayer(layer, "layer", "lenient"));
  if (rejected) return rejected;
  const [row] = await sql`
    INSERT INTO starred_items (user_id, name, kind, layer, source_project_id, source_project_name, last_used_at)
    VALUES (${user.id}, ${name}, ${kind}, ${sql.json(layer)}, ${typeof sourceProjectId === "string" ? sourceProjectId : null}, ${typeof sourceProjectName === "string" ? sourceProjectName : null}, now())
    RETURNING id, name, kind, source_project_id AS "sourceProjectId", source_project_name AS "sourceProjectName",
      (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt", (extract(epoch from last_used_at) * 1000)::float8 AS "lastUsedAt"`;
  return c.json(row);
});

app.put("/api/starred/:id", async (c) => {
  const user = c.get("user") as User;
  const { name } = await c.req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) return c.json({ error: "bad request" }, 400);
  const [row] = await sql`
    UPDATE starred_items SET name = ${name}, updated_at = now()
    WHERE id = ${c.req.param("id")} AND user_id = ${user.id}
    RETURNING id, name, kind, (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"`;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.delete("/api/starred/:id", async (c) => {
  const user = c.get("user") as User;
  await sql`DELETE FROM starred_items WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  return c.json({ ok: true });
});

// Insertion is a use event, separate from editing a favourite's name. This powers
// the default manager view without making a frequently-used item look recently edited.
app.post("/api/starred/:id/use", async (c) => {
  const user = c.get("user") as User;
  const [row] = await sql`
    UPDATE starred_items SET last_used_at = now()
    WHERE id = ${c.req.param("id")} AND user_id = ${user.id}
    RETURNING id`;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ── blobs (content-addressed image bytes) ─────────────────────────────────────
const MAX_BLOB = 25 * 1024 * 1024; // 25 MB per image — generous for a thumbnail source

app.post("/api/blobs", async (c) => {
  const user = c.get("user") as User;
  const contentType = c.req.header("content-type") || "application/octet-stream";
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (buf.byteLength === 0) return c.json({ error: "empty" }, 400);
  if (buf.byteLength > MAX_BLOB) return c.json({ error: "too large" }, 413);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const id = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
  // Upload only if this exact content isn't in R2 yet; always record ownership.
  const existing = await sql`SELECT 1 FROM blobs WHERE id = ${id} LIMIT 1`;
  if (existing.length === 0) await putBlob(id, buf, contentType);
  await sql`
    INSERT INTO blobs (id, user_id, content_type, size) VALUES (${id}, ${user.id}, ${contentType}, ${buf.byteLength})
    ON CONFLICT (id, user_id) DO NOTHING`;
  return c.json({ id });
});

app.get("/api/blobs/:id", async (c) => {
  const user = c.get("user") as User;
  const id = c.req.param("id");
  const rows = await sql<{ content_type: string }[]>`
    SELECT content_type FROM blobs WHERE id = ${id} AND user_id = ${user.id}`;
  if (!rows[0]) return c.json({ error: "not found" }, 404);
  const bytes = await getBlob(id);
  if (!bytes) return c.json({ error: "not found" }, 404);
  return new Response(bytes, {
    headers: { "content-type": rows[0].content_type, "cache-control": "private, max-age=31536000, immutable" },
  });
});

// The published document format. Public on purpose: it's a spec, not data. Anything that
// authors a ThumbDoc (the MCP server, a script, a future client) validates against this.
app.get("/api/schema", (c) => c.json(docSchema));

// Health means "can serve requests", which for this API means "can reach Postgres". Returning
// ok while the database is down is how an orchestrator keeps a broken container in rotation.
app.get("/api/health", async (c) => {
  try {
    await sql`SELECT 1`;
    return c.json({ ok: true });
  } catch (err) {
    console.warn("[health] database unreachable", err);
    return c.json({ ok: false, error: "database unreachable" }, 503);
  }
});

// Exported for the tests, which drive the routes through `app.request()` instead of a socket.
export { app };

// Background sweeps (expired sessions, unreferenced blobs). Guarded on `import.meta.main` so
// importing the app in a test never schedules them.
if (import.meta.main) startMaintenance();

// PORT is only for running the API alongside something else locally; Compose leaves it unset.
export default { port: Number(process.env.PORT ?? 3000), fetch: app.fetch, idleTimeout: 60 };
