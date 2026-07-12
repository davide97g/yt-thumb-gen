// yt-thumb-gen backend — Bun + Hono.
//
// Serves the /api surface consumed by the SPA (which nginx proxies same-origin, so no
// CORS here). Auth is an httpOnly session cookie backed by the `sessions` table.
// Named projects live in Postgres; image bytes live in R2 (content-addressed).

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { initSchema, sql } from "./db";
import { getBlob, putBlob } from "./r2";

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

async function currentUser(c: any): Promise<User | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const rows = await sql<User[]>`
    SELECT u.id, u.email FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now()`;
  return rows[0] ?? null;
}

async function signupOpen(): Promise<boolean> {
  if (ALLOW_SIGNUP) return true;
  const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM users`;
  return count === "0";
}

const emailOk = (e: unknown): e is string => typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

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
  if (!emailOk(email)) return c.json({ error: "Email non valida" }, 400);
  if (typeof password !== "string" || password.length < 8) return c.json({ error: "Password troppo corta (min 8)" }, 400);
  const hash = await Bun.password.hash(password);
  try {
    const [u] = await sql<User[]>`INSERT INTO users (email, password_hash) VALUES (${email.toLowerCase()}, ${hash}) RETURNING id, email`;
    setSessionCookie(c, await createSession(u.id));
    return c.json({ id: u.id, email: u.email });
  } catch {
    return c.json({ error: "Email già registrata" }, 409);
  }
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  if (!emailOk(email) || typeof password !== "string") return c.json({ error: "Credenziali non valide" }, 400);
  const rows = await sql<{ id: string; email: string; password_hash: string }[]>`
    SELECT id, email, password_hash FROM users WHERE email = ${email.toLowerCase()}`;
  const u = rows[0];
  if (!u || !(await Bun.password.verify(password, u.password_hash))) return c.json({ error: "Credenziali non valide" }, 401);
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

async function requireUser(c: any, next: () => Promise<void>) {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  return next();
}

// ── projects ────────────────────────────────────────────────────────────────
app.get("/api/projects", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name, extract(epoch from updated_at) * 1000 AS "updatedAt"
    FROM projects WHERE user_id = ${user.id} ORDER BY updated_at DESC`;
  return c.json(rows);
});

app.get("/api/projects/:id", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name, doc, extract(epoch from updated_at) * 1000 AS "updatedAt"
    FROM projects WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  if (!rows[0]) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

app.post("/api/projects", async (c) => {
  const user = c.get("user") as User;
  const { name, doc } = await c.req.json().catch(() => ({}));
  if (typeof name !== "string" || typeof doc !== "object" || doc === null) return c.json({ error: "bad request" }, 400);
  const [row] = await sql`
    INSERT INTO projects (user_id, name, doc) VALUES (${user.id}, ${name}, ${sql.json(doc)})
    RETURNING id, name, extract(epoch from updated_at) * 1000 AS "updatedAt"`;
  return c.json(row);
});

app.put("/api/projects/:id", async (c) => {
  const user = c.get("user") as User;
  const { name, doc } = await c.req.json().catch(() => ({}));
  const [row] = await sql`
    UPDATE projects SET
      name = coalesce(${name ?? null}, name),
      doc = coalesce(${doc === undefined ? null : sql.json(doc)}, doc),
      updated_at = now()
    WHERE id = ${c.req.param("id")} AND user_id = ${user.id}
    RETURNING id, name, extract(epoch from updated_at) * 1000 AS "updatedAt"`;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.delete("/api/projects/:id", async (c) => {
  const user = c.get("user") as User;
  await sql`DELETE FROM projects WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  return c.json({ ok: true });
});

// ── starred elements (single layers saved into a per-user collection) ────────
app.get("/api/starred", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name, kind, extract(epoch from updated_at) * 1000 AS "updatedAt"
    FROM starred_items WHERE user_id = ${user.id} ORDER BY updated_at DESC`;
  return c.json(rows);
});

app.get("/api/starred/:id", async (c) => {
  const user = c.get("user") as User;
  const rows = await sql`
    SELECT id, name, kind, layer, extract(epoch from updated_at) * 1000 AS "updatedAt"
    FROM starred_items WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
  if (!rows[0]) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

app.post("/api/starred", async (c) => {
  const user = c.get("user") as User;
  const { name, kind, layer } = await c.req.json().catch(() => ({}));
  if (typeof name !== "string" || typeof kind !== "string" || typeof layer !== "object" || layer === null) {
    return c.json({ error: "bad request" }, 400);
  }
  const [row] = await sql`
    INSERT INTO starred_items (user_id, name, kind, layer) VALUES (${user.id}, ${name}, ${kind}, ${sql.json(layer)})
    RETURNING id, name, kind, extract(epoch from updated_at) * 1000 AS "updatedAt"`;
  return c.json(row);
});

app.put("/api/starred/:id", async (c) => {
  const user = c.get("user") as User;
  const { name } = await c.req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) return c.json({ error: "bad request" }, 400);
  const [row] = await sql`
    UPDATE starred_items SET name = ${name}, updated_at = now()
    WHERE id = ${c.req.param("id")} AND user_id = ${user.id}
    RETURNING id, name, kind, extract(epoch from updated_at) * 1000 AS "updatedAt"`;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.delete("/api/starred/:id", async (c) => {
  const user = c.get("user") as User;
  await sql`DELETE FROM starred_items WHERE id = ${c.req.param("id")} AND user_id = ${user.id}`;
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

app.get("/api/health", (c) => c.json({ ok: true }));

export default { port: 3000, fetch: app.fetch, idleTimeout: 60 };
