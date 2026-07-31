// Route-level tests for the API — the largest thing in the repo that nothing was checking.
//
// They drive the real Hono app through `app.request()` against a real Postgres, because the
// invariants worth protecting here are SQL invariants: which rows a user can see, what a PUT
// leaves alone, whether a credential can escalate itself. Mocking the database would test the
// mock.
//
//   docker run -d --name thumb-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=thumbtest \
//     -p 55432:5432 postgres:16
//   DATABASE_URL=postgres://postgres:postgres@localhost:55432/thumbtest bun test server
//
// **The suite truncates every table it touches**, so it refuses to run unless the database
// name says "test". Without DATABASE_URL it skips silently — `bun run check` still passes on
// a machine with no Postgres, and CI supplies one.

import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

const DB = process.env.DATABASE_URL;
const usable = !!DB && /test/i.test(DB);
if (DB && !usable) {
  console.warn(`[app.test] refusing to run against ${DB} — the suite truncates, so the database name must contain "test".`);
}

// Bun loads `.env` automatically, and a developer's has ALLOW_SIGNUP=true — which would quietly
// turn the "signup locks after the first user" test into a no-op. Pin it before the app reads it.
process.env.ALLOW_SIGNUP = "false";

// R2 is never called here (no blob route is exercised), but its module throws at import
// unless it can construct a client, so it needs credentials shaped like credentials.
process.env.R2_ENDPOINT ??= "https://example.invalid";
process.env.R2_ACCESS_KEY_ID ??= "test";
process.env.R2_SECRET_ACCESS_KEY ??= "test";
process.env.R2_BUCKET ??= "test";

type Api = { app: { request: (path: string, init?: RequestInit) => Promise<Response> } };
let api: Api["app"];
let sql: any;

/** A logged-in user: its id plus the cookie header that authenticates it. */
type Session = { id: string; email: string; cookie: string };

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const send = (method: string, body: unknown, cookie?: string, bearer?: string): RequestInit => ({
  method,
  headers: {
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
  },
  body: JSON.stringify(body),
});

const auth = (cookie?: string, bearer?: string): RequestInit => ({
  headers: { ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
});

/** The one valid document the tests reuse. Kept minimal on purpose: this file is about
 *  routes, and `validate.ts` has its own tests for the document contract. */
const doc = (extra: Record<string, unknown> = {}) => ({
  format: "youtube",
  background: { mode: "solid", from: "#000000", to: "#000000", image: null, overlay: 0 },
  layers: [],
  ...extra,
});

let seq = 0;
const nextEmail = () => `user${++seq}@example.test`;

/** Registers through the real endpoint. Only usable while signup is open — i.e. for the
 *  first user of a truncated database. */
async function register(email = nextEmail(), password = "password123"): Promise<Session> {
  const res = await api.request("/api/auth/register", json({ email, password }));
  expect(res.status).toBe(200);
  const { id } = (await res.json()) as { id: string };
  return { id, email, cookie: cookieOf(res) };
}

/** Signup locks after the first user, which is the point — so extra users are seeded the way
 *  an operator would (straight into the table) and then log in for real. */
async function seedUser(email = nextEmail(), password = "password123"): Promise<Session> {
  const hash = await Bun.password.hash(password);
  await sql`INSERT INTO users (email, password_hash) VALUES (${email}, ${hash})`;
  const res = await api.request("/api/auth/login", json({ email, password }));
  expect(res.status).toBe(200);
  const { id } = (await res.json()) as { id: string };
  return { id, email, cookie: cookieOf(res) };
}

function cookieOf(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const sid = /(^|,\s*)(sid=[^;]+)/.exec(header)?.[2];
  if (!sid) throw new Error(`no session cookie in ${header || "(empty)"}`);
  return sid;
}

describe.skipIf(!usable)("api", () => {
  beforeAll(async () => {
    // Importing the app runs initSchema(), so the tables exist before the first truncate.
    ({ app: api } = (await import("./index")) as unknown as Api);
    ({ sql } = await import("./db"));
  });

  beforeEach(async () => {
    // Every dependent table is named explicitly rather than left to CASCADE — same effect,
    // minus a wall of "truncate cascades to …" notices on every single test.
    await sql`TRUNCATE users, sessions, projects, campaigns, blobs, api_tokens, starred_items RESTART IDENTITY CASCADE`;
  });

  // ── auth ───────────────────────────────────────────────────────────────────
  test("the first account is free, the second is refused", async () => {
    expect(await (await api.request("/api/auth/status")).json()).toEqual({ signupOpen: true });
    await register();
    expect(await (await api.request("/api/auth/status")).json()).toEqual({ signupOpen: false });
    const second = await api.request("/api/auth/register", json({ email: nextEmail(), password: "password123" }));
    expect(second.status).toBe(403);
  });

  test("login rejects a wrong password without saying which half was wrong", async () => {
    const user = await register(nextEmail(), "password123");
    const res = await api.request("/api/auth/login", json({ email: user.email, password: "wrong-one" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid credentials");
  });

  test("a session cookie identifies its user; no cookie is a 401", async () => {
    const user = await register();
    expect((await api.request("/api/auth/me", auth(user.cookie))).status).toBe(200);
    expect((await api.request("/api/auth/me")).status).toBe(401);
  });

  test("logout kills the session server-side, not just the cookie", async () => {
    const user = await register();
    await api.request("/api/auth/logout", { method: "POST", headers: { cookie: user.cookie } });
    expect((await api.request("/api/auth/me", auth(user.cookie))).status).toBe(401);
  });

  // ── tokens ─────────────────────────────────────────────────────────────────
  test("a bearer token reaches the API but can never mint another token", async () => {
    const user = await register();
    const made = await api.request("/api/tokens", send("POST", { name: "agent" }, user.cookie));
    const { token } = (await made.json()) as { token: string };
    expect(token).toStartWith("tsk_");

    // It works where it's meant to…
    expect((await api.request("/api/projects", auth(undefined, token))).status).toBe(200);
    // …and is powerless over its own kind, so a leaked token can't entrench itself.
    expect((await api.request("/api/tokens", auth(undefined, token))).status).toBe(401);
    expect((await api.request("/api/tokens", send("POST", { name: "second" }, undefined, token))).status).toBe(401);
  });

  test("only the hash of a token is stored", async () => {
    const user = await register();
    const { token } = (await (await api.request("/api/tokens", send("POST", { name: "agent" }, user.cookie))).json()) as {
      token: string;
    };
    const rows = await sql`SELECT token_hash FROM api_tokens`;
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── projects ───────────────────────────────────────────────────────────────
  test("a project round-trips, and the list carries metadata only", async () => {
    const user = await register();
    const created = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc() }, user.cookie))).json();
    const list = await (await api.request("/api/projects", auth(user.cookie))).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, name: "One", format: "youtube" });
    expect(list[0].doc).toBeUndefined();
    expect((await (await api.request(`/api/projects/${created.id}`, auth(user.cookie))).json()).doc.format).toBe("youtube");
  });

  test("a rename leaves the document alone", async () => {
    const user = await register();
    // Shaped like `newShapeLayer("rect")`, so the document contract passes cleanly and the
    // test isn't quietly riding on validation being in warn mode.
    const layered = doc({
      layers: [
        { type: "shape", kind: "rect", id: "s1", name: "Box", x: 0, y: 0, w: 10, h: 10, rotation: 0, visible: true, fill: "#e8633a", radius: 16, pct: 72, trackColor: "rgba(255,255,255,.35)" },
      ],
    });
    const created = await (await api.request("/api/projects", send("POST", { name: "One", doc: layered }, user.cookie))).json();
    await api.request(`/api/projects/${created.id}`, send("PUT", { name: "Renamed" }, user.cookie));
    const after = await (await api.request(`/api/projects/${created.id}`, auth(user.cookie))).json();
    expect(after.name).toBe("Renamed");
    expect(after.doc.layers).toHaveLength(1);
  });

  test("a save without a preview keeps the last one", async () => {
    const user = await register();
    const sha = "a".repeat(64);
    const created = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc(), preview: sha }, user.cookie))).json();
    expect(created.preview).toBe(sha);
    const renamed = await (await api.request(`/api/projects/${created.id}`, send("PUT", { name: "Two" }, user.cookie))).json();
    expect(renamed.preview).toBe(sha);
  });

  test("a preview that isn't a blob id is dropped, not fatal", async () => {
    const user = await register();
    const res = await api.request("/api/projects", send("POST", { name: "One", doc: doc(), preview: "../../etc/passwd" }, user.cookie));
    expect(res.status).toBe(200);
    expect((await res.json()).preview).toBeNull();
  });

  test("one user's projects are invisible to another", async () => {
    const owner = await register();
    const other = await seedUser();
    const mine = await (await api.request("/api/projects", send("POST", { name: "Mine", doc: doc() }, owner.cookie))).json();

    expect(await (await api.request("/api/projects", auth(other.cookie))).json()).toEqual([]);
    expect((await api.request(`/api/projects/${mine.id}`, auth(other.cookie))).status).toBe(404);
    expect((await api.request(`/api/projects/${mine.id}`, send("PUT", { name: "Stolen" }, other.cookie))).status).toBe(404);

    // A delete by a stranger reports ok but must not have deleted anything.
    await api.request(`/api/projects/${mine.id}`, { method: "DELETE", headers: { cookie: other.cookie } });
    expect((await api.request(`/api/projects/${mine.id}`, auth(owner.cookie))).status).toBe(200);
  });

  // ── campaigns ──────────────────────────────────────────────────────────────
  test("campaignId is tri-state: absent leaves it, null unfiles, an id files", async () => {
    const user = await register();
    const camp = await (await api.request("/api/campaigns", send("POST", { name: "Launch" }, user.cookie))).json();
    const p = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc(), campaignId: camp.id }, user.cookie))).json();
    expect(p.campaignId).toBe(camp.id);

    const renamed = await (await api.request(`/api/projects/${p.id}`, send("PUT", { name: "Two" }, user.cookie))).json();
    expect(renamed.campaignId).toBe(camp.id); // key absent → untouched

    const unfiled = await (await api.request(`/api/projects/${p.id}`, send("PUT", { campaignId: null }, user.cookie))).json();
    expect(unfiled.campaignId).toBeNull();
  });

  test("a project can't be filed into someone else's campaign", async () => {
    const owner = await register();
    const other = await seedUser();
    const camp = await (await api.request("/api/campaigns", send("POST", { name: "Theirs" }, owner.cookie))).json();
    const res = await api.request("/api/projects", send("POST", { name: "One", doc: doc(), campaignId: camp.id }, other.cookie));
    expect(res.status).toBe(404);
  });

  test("deleting a campaign keeps its designs", async () => {
    const user = await register();
    const camp = await (await api.request("/api/campaigns", send("POST", { name: "Launch" }, user.cookie))).json();
    const p = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc(), campaignId: camp.id }, user.cookie))).json();
    await api.request(`/api/campaigns/${camp.id}`, { method: "DELETE", headers: { cookie: user.cookie } });

    const after = await (await api.request(`/api/projects/${p.id}`, auth(user.cookie))).json();
    expect(after.campaignId).toBeNull();
  });

  test("the campaign list counts its designs", async () => {
    const user = await register();
    const camp = await (await api.request("/api/campaigns", send("POST", { name: "Launch" }, user.cookie))).json();
    await api.request("/api/projects", send("POST", { name: "One", doc: doc(), campaignId: camp.id }, user.cookie));
    await api.request("/api/projects", send("POST", { name: "Two", doc: doc(), campaignId: camp.id }, user.cookie));
    const [row] = await (await api.request("/api/campaigns", auth(user.cookie))).json();
    expect(row.designCount).toBe(2);
  });

  // ── contract ───────────────────────────────────────────────────────────────
  test("a malformed document is refused up front", async () => {
    const user = await register();
    const res = await api.request("/api/projects", send("POST", { name: "One", doc: "not a document" }, user.cookie));
    expect(res.status).toBe(400);
  });

  test("the schema is public — it's a spec, not data", async () => {
    const res = await api.request("/api/schema");
    expect(res.status).toBe(200);
    expect((await res.json()).$ref ?? (await res.json()).definitions).toBeDefined();
  });
});
