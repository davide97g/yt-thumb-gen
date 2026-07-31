// yt-thumb-gen backend — Bun + Hono.
//
// Serves the /api surface consumed by the SPA (which nginx proxies same-origin, so no
// CORS here). Auth is an httpOnly session cookie backed by the `sessions` table.
// Named projects live in Postgres; image bytes live in R2 (content-addressed).

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { initSchema, sql } from "./db";
import { getBlob, putBlob } from "./r2";
import { MODE, docWarnings, schema as docSchema, validateDoc, validateLayer } from "./validate";

const APP_URL = process.env.APP_URL ?? "http://localhost";
const SECURE = APP_URL.startsWith("https://");
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP === "true";
const SESSION_DAYS = 30;
const COOKIE = "sid";

await initSchema();

// ── helpers ───────────────────────────────────────────────────────────────
type User = { id: string; email: string };

const app = new Hono<{ Variables: { user: User } }>();

function newToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function createSession(userId: string): Promise<string> {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, ${expires})`;
  return token;
}

function setSessionCookie(c: any, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: SECURE,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

const sha256 = async (s: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (x) =>
    x.toString(16).padStart(2, "0")
  ).join("");

/** Identity from the browser session cookie. */
async function cookieUser(c: any): Promise<User | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const rows = await sql<User[]>`
    SELECT u.id, u.email FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now()`;
  return rows[0] ?? null;
}

/** Identity from an `Authorization: Bearer tsk_…` personal API token. nginx forwards the
 *  header untouched, so this works the same behind the proxy as it does locally. */
async function bearerUser(c: any): Promise<User | null> {
  const header = c.req.header("authorization");
  const raw = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!raw) return null;
  const rows = await sql<User[]>`
    SELECT u.id, u.email FROM api_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ${await sha256(raw)}`;
  const user = rows[0];
  if (!user) return null;
  // Best-effort usage stamp; never block the request on it.
  sql`UPDATE api_tokens SET last_used_at = now() WHERE token_hash = ${await sha256(raw)}`.catch(() => {});
  return user;
}

async function currentUser(c: any): Promise<User | null> {
  return (await cookieUser(c)) ?? (await bearerUser(c));
}

async function signupOpen(): Promise<boolean> {
  if (ALLOW_SIGNUP) return true;
  const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM users`;
  return count === "0";
}

const emailOk = (e: unknown): e is string => typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

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
app.get("/api/auth/status", async (c) => c.json({ signupOpen: await signupOpen() }));

app.get("/api/auth/me", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({ id: user.id, email: user.email });
});

app.post("/api/auth/register", async (c) => {
  if (!(await signupOpen())) return c.json({ error: "Registrazioni chiuse" }, 403);
  const { email, password } = await c.req.json().catch(() => ({}));
  if (!emailOk(email)) return c.json({ error: "Invalid email" }, 400);
  if (typeof password !== "string" || password.length < 8) return c.json({ error: "Password too short (min 8)" }, 400);
  const hash = await Bun.password.hash(password);
  try {
    const [u] = await sql<User[]>`INSERT INTO users (email, password_hash) VALUES (${email.toLowerCase()}, ${hash}) RETURNING id, email`;
    setSessionCookie(c, await createSession(u.id));
    return c.json({ id: u.id, email: u.email });
  } catch {
    return c.json({ error: "Email already registered" }, 409);
  }
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  if (!emailOk(email) || typeof password !== "string") return c.json({ error: "Invalid credentials" }, 400);
  const rows = await sql<{ id: string; email: string; password_hash: string }[]>`
    SELECT id, email, password_hash FROM users WHERE email = ${email.toLowerCase()}`;
  const u = rows[0];
  if (!u || !(await Bun.password.verify(password, u.password_hash))) return c.json({ error: "Invalid credentials" }, 401);
  setSessionCookie(c, await createSession(u.id));
  return c.json({ id: u.id, email: u.email });
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await sql`DELETE FROM sessions WHERE token = ${token}`;
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
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
// Token management is cookie-only on purpose: a token must not be able to mint another
// token, so a leaked token cannot be used to entrench itself.
app.use("/api/tokens/*", requireCookieUser);
app.use("/api/tokens", requireCookieUser);

async function requireUser(c: any, next: () => Promise<void>) {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  return next();
}

async function requireCookieUser(c: any, next: () => Promise<void>) {
  const user = await cookieUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
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
    SELECT id, name, campaign_id AS "campaignId", doc->>'format' AS format,
      (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"
    FROM projects WHERE user_id = ${user.id} ORDER BY updated_at DESC`;
  return c.json(rows);
});

app.get("/api/projects/:id", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name, doc, campaign_id AS "campaignId", (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"
    FROM projects WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  if (!rows[0]) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

/** Resolves a caller-supplied campaign id to something safe to store. Returns `false` when
 *  the campaign isn't the caller's, so a project can never be filed into someone else's. */
async function resolveCampaign(userId: string, value: unknown): Promise<string | null | false> {
  if (value === null) return null;
  if (typeof value !== "string" || !value) return false;
  const rows = await sql`SELECT id FROM campaigns WHERE id = ${value} AND user_id = ${userId}`;
  return rows[0] ? value : false;
}

app.post("/api/projects", async (c) => {
  const user = c.get("user") as User;
  const { name, doc, campaignId } = await c.req.json().catch(() => ({}));
  if (typeof name !== "string" || typeof doc !== "object" || doc === null) return c.json({ error: "bad request" }, 400);
  const rejected = docProblems("POST /projects", validateDoc(doc));
  if (rejected) return rejected;
  const campaign = campaignId === undefined ? null : await resolveCampaign(user.id, campaignId);
  if (campaign === false) return c.json({ error: "Campaign not found" }, 404);
  const [row] = await sql`
    INSERT INTO projects (user_id, name, doc, campaign_id)
    VALUES (${user.id}, ${name}, ${sql.json(doc)}, ${campaign})
    RETURNING id, name, campaign_id AS "campaignId", (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"`;
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
  }
  // Tri-state: key absent = leave the campaign alone, null = unfile, id = file. `coalesce`
  // can't express "set to null", so the column is only touched when the key is present.
  const hasCampaign = "campaignId" in body;
  const campaign = hasCampaign ? await resolveCampaign(user.id, body.campaignId) : null;
  if (campaign === false) return c.json({ error: "Campaign not found" }, 404);
  const [row] = await sql`
    UPDATE projects SET
      name = coalesce(${name ?? null}, name),
      doc = coalesce(${doc === undefined ? null : sql.json(doc)}, doc),
      campaign_id = ${hasCampaign ? campaign : sql`campaign_id`},
      updated_at = now()
    WHERE id = ${c.req.param("id")} AND user_id = ${user.id}
    RETURNING id, name, campaign_id AS "campaignId", (extract(epoch from updated_at) * 1000)::float8 AS "updatedAt"`;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.delete("/api/projects/:id", async (c) => {
  const user = c.get("user") as User;
  await sql`DELETE FROM projects WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  return c.json({ ok: true });
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
    SELECT id, name, doc->>'format' AS format,
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

// ── personal API tokens (cookie-only; see the guard above) ──────────────────
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

app.get("/api/health", (c) => c.json({ ok: true }));

// PORT is only for running the API alongside something else locally; Compose leaves it unset.
export default { port: Number(process.env.PORT ?? 3000), fetch: app.fetch, idleTimeout: 60 };
