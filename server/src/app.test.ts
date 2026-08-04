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

import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const DB = process.env.DATABASE_URL;
const usable = !!DB && /test/i.test(DB);
if (DB && !usable) {
  console.warn(`[app.test] refusing to run against ${DB} — the suite truncates, so the database name must contain "test".`);
}

// Bun loads `.env` automatically, and a developer's has a real ALLOWED_EMAILS with one address
// in it — which would refuse every user these tests create. Most of the file wants "anyone may
// have an account", i.e. the empty-allowlist arm, so pin it before the app reads it; the two
// tests that are *about* the allowlist set it themselves (it's read per call, see identity.ts).
process.env.ALLOWED_EMAILS = "";

// The object store stands in for R2. The blob routes are about *authorization* — which caller
// is allowed which bytes — and that decision is made in SQL, before the store is ever asked.
// A map keeps the tests honest about the decision without a network or a bucket.
const objects = new Map<string, Uint8Array>();
mock.module("./r2", () => ({
  putBlob: async (id: string, bytes: Uint8Array) => { objects.set(id, bytes); },
  deleteBlob: async (id: string) => { objects.delete(id); },
  getBlob: async (id: string) => objects.get(id)?.buffer ?? null,
}));

// Clerk stands in the same place R2 does: it is the network edge, so it is what gets replaced.
// Everything downstream of it is real — the allowlist, the provisioning, the email-matching that
// claims an existing row, and every `user_id` scoping rule in the file — which is the point of
// splitting verification (`clerk.ts`) from identity (`identity.ts`) at all. A verified session is
// therefore just a cookie naming an address, and one Clerk id per address, deterministically.
mock.module("./clerk", () => ({
  clerkConfigured: () => true,
  verifyClerkRequest: async (req: Request) => {
    const email = req.headers.get("cookie")?.match(/(?:^|;\s*)clerk=([^;]+)/)?.[1];
    if (!email) return null;
    const address = decodeURIComponent(email).toLowerCase();
    return { clerkId: `user_${address}`, email: async () => address };
  },
}));

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

/** A fresh caller address per helper call. The auth routes are rate-limited per address and
 *  the limiters are module state shared by the whole file, so without this the suite would
 *  throttle itself somewhere around the tenth registration — and the failure would look like
 *  a bug in whichever test happened to be Nth. */
let ips = 0;
const nextIp = () => `10.0.${Math.floor(ips / 250)}.${++ips % 250}`;
const fromIp = (init: RequestInit, ip = nextIp()): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), "x-real-ip": ip },
});

/** The header a signed-in browser would carry, for a given address. */
const sessionCookie = (email: string): string => `clerk=${encodeURIComponent(email)}`;

/** Addresses this suite has put on the allowlist. Every test that needs two users needs both of
 *  them admitted: with `ALLOWED_EMAILS` empty the rule is "the first account claims the
 *  instance", which would refuse the second one. Reset per test by `beforeEach`. */
let admitted: string[] = [];
function admit(email: string): void {
  admitted.push(email.toLowerCase());
  process.env.ALLOWED_EMAILS = admitted.join(",");
}

/** Signs in as `email`, provisioning the row on the way through exactly as a first Google
 *  sign-in does, and hands back what the rest of the file needs to act as that user.
 *
 *  Always a fresh address by default, and that matters: `identity.ts` caches its resolution per
 *  Clerk id, and the cache is module state that `TRUNCATE` between tests cannot reach. Reusing
 *  an address across tests would hand back a uuid whose row no longer exists. */
async function signIn(email = nextEmail()): Promise<Session> {
  admit(email);
  const cookie = sessionCookie(email);
  const res = await api.request("/api/auth/me", fromIp(auth(cookie)));
  expect(res.status).toBe(200);
  const { id } = (await res.json()) as { id: string };
  return { id, email, cookie };
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
    await sql`TRUNCATE users, projects, campaigns, blobs, api_tokens, starred_items RESTART IDENTITY CASCADE`;
    // The allowlist is module *environment*, not database state, so the truncate above can't
    // reach it. Cleared here rather than in each test's `finally`, so a failing assertion can
    // never leak an allowlist into the next test.
    admitted = [];
    process.env.ALLOWED_EMAILS = "";
  });

  // ── auth ───────────────────────────────────────────────────────────────────
  test("a Clerk session identifies its user; no session is a 401", async () => {
    const user = await signIn();
    expect((await api.request("/api/auth/me", auth(user.cookie))).status).toBe(200);
    expect((await api.request("/api/auth/me")).status).toBe(401);
  });

  test("a first sign-in provisions one row and reuses it thereafter", async () => {
    const user = await signIn();
    const [row] = await sql`SELECT id, email, clerk_id, password_hash FROM users`;
    expect(row).toMatchObject({ id: user.id, email: user.email, clerk_id: `user_${user.email}` });
    // Nothing writes a password any more, which is why migration 008 dropped the NOT NULL.
    expect(row.password_hash).toBeNull();

    // Signing in again is the same account, not a second one.
    expect((await signIn(user.email)).id).toBe(user.id);
    expect(await sql`SELECT 1 FROM users`).toHaveLength(1);
  });

  // The whole migration story, in one test. An account created under password auth is matched
  // **by email** and claimed — if this were an insert instead, the owner would sign in with
  // Google and find an empty workspace while their designs sat on an orphaned row.
  test("an existing account is claimed by email, keeping everything it owns", async () => {
    const email = nextEmail();
    const [legacy] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash) VALUES (${email}, 'argon2-from-the-old-world') RETURNING id`;
    await sql`INSERT INTO projects (user_id, name, doc, format)
      VALUES (${legacy.id}, 'Made before Clerk', ${sql.json(doc())}, 'youtube')`;

    const user = await signIn(email);
    expect(user.id).toBe(legacy.id); // the same row, now linked
    expect(await sql`SELECT 1 FROM users`).toHaveLength(1);
    const list = await (await api.request("/api/projects", auth(user.cookie))).json();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Made before Clerk");
  });

  // A Google button is reachable by every Google account there is, so the gate has to be stated
  // somewhere. 403 rather than 401 on purpose: the credential is valid, the account isn't
  // welcome, and only the server knows which of those two things went wrong.
  test("the allowlist refuses an address it doesn't name, and admits one it does", async () => {
    const [welcome, stranger] = [nextEmail(), nextEmail()];
    process.env.ALLOWED_EMAILS = `  ${welcome.toUpperCase()} `; // trimmed and lowercased on read
    expect((await api.request("/api/auth/me", auth(sessionCookie(welcome)))).status).toBe(200);
    const refused = await api.request("/api/auth/me", auth(sessionCookie(stranger)));
    expect(refused.status).toBe(403);
    // Refused means refused everywhere, not just at the front door.
    expect((await api.request("/api/projects", auth(sessionCookie(stranger)))).status).toBe(403);
    // And no row was created for them.
    expect(await sql`SELECT 1 FROM users`).toHaveLength(1);
  });

  // With no allowlist configured the rule is the one this replaced: the first account claims
  // the instance. That is what keeps a deployment whose operator hasn't set ALLOWED_EMAILS from
  // handing a workspace to whoever finds the URL. Signs in by hand rather than through the
  // `signIn` helper, precisely because that helper's job is to put an address on the allowlist.
  test("with no allowlist, the first account is free and the second is refused", async () => {
    expect((await api.request("/api/auth/me", auth(sessionCookie(nextEmail())))).status).toBe(200);
    expect((await api.request("/api/auth/me", auth(sessionCookie(nextEmail())))).status).toBe(403);
  });

  test("sign-in reports whether it is configured at all", async () => {
    expect(await (await api.request("/api/auth/status")).json()).toEqual({ clerk: true });
  });

  // ── tokens ─────────────────────────────────────────────────────────────────
  test("a bearer token reaches the API but can never mint another token", async () => {
    const user = await signIn();
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
    const user = await signIn();
    const { token } = (await (await api.request("/api/tokens", send("POST", { name: "agent" }, user.cookie))).json()) as {
      token: string;
    };
    const rows = await sql`SELECT token_hash FROM api_tokens`;
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── projects ───────────────────────────────────────────────────────────────
  test("a project round-trips, and the list carries metadata only", async () => {
    const user = await signIn();
    const created = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc() }, user.cookie))).json();
    const list = await (await api.request("/api/projects", auth(user.cookie))).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, name: "One", format: "youtube" });
    expect(list[0].doc).toBeUndefined();
    expect((await (await api.request(`/api/projects/${created.id}`, auth(user.cookie))).json()).doc.format).toBe("youtube");
  });

  test("a rename leaves the document alone", async () => {
    const user = await signIn();
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

  // `projects.format` is denormalised (migration 005) so a list of sixty designs doesn't
  // decompress sixty documents to print sixty words. The cost of that is a column that can
  // now *disagree* with the document it labels — so every path that stores a doc has to
  // restate it, and every path that doesn't must leave it alone. That's what these pin.
  test("the archive's format label follows the document it labels", async () => {
    const user = await signIn();
    const format = async (id: string) =>
      ((await (await api.request("/api/projects", auth(user.cookie))).json()) as { id: string; format: string }[]).find((p) => p.id === id)?.format;

    const created = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc() }, user.cookie))).json();
    expect(await format(created.id)).toBe("youtube");

    // A save that changes the format relabels the row.
    await api.request(`/api/projects/${created.id}`, send("PUT", { doc: doc({ format: "shorts" }) }, user.cookie));
    expect(await format(created.id)).toBe("shorts");

    // A rename sends no document, so it can't touch the label.
    await api.request(`/api/projects/${created.id}`, send("PUT", { name: "Two" }, user.cookie));
    expect(await format(created.id)).toBe("shorts");

    // A restore replaces the document, so it relabels too.
    const versions = await (await api.request(`/api/projects/${created.id}/versions`, auth(user.cookie))).json();
    const first = versions[versions.length - 1];
    await api.request(`/api/projects/${created.id}/versions/${first.id}/restore`, send("POST", {}, user.cookie));
    expect(await format(created.id)).toBe("youtube");
  });

  test("a save without a preview keeps the last one", async () => {
    const user = await signIn();
    const sha = "a".repeat(64);
    const created = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc(), preview: sha }, user.cookie))).json();
    expect(created.preview).toBe(sha);
    const renamed = await (await api.request(`/api/projects/${created.id}`, send("PUT", { name: "Two" }, user.cookie))).json();
    expect(renamed.preview).toBe(sha);
  });

  test("a preview that isn't a blob id is dropped, not fatal", async () => {
    const user = await signIn();
    const res = await api.request("/api/projects", send("POST", { name: "One", doc: doc(), preview: "../../etc/passwd" }, user.cookie));
    expect(res.status).toBe(200);
    expect((await res.json()).preview).toBeNull();
  });

  test("one user's projects are invisible to another", async () => {
    const owner = await signIn();
    const other = await signIn();
    const mine = await (await api.request("/api/projects", send("POST", { name: "Mine", doc: doc() }, owner.cookie))).json();

    expect(await (await api.request("/api/projects", auth(other.cookie))).json()).toEqual([]);
    expect((await api.request(`/api/projects/${mine.id}`, auth(other.cookie))).status).toBe(404);
    expect((await api.request(`/api/projects/${mine.id}`, send("PUT", { name: "Stolen" }, other.cookie))).status).toBe(404);

    // A delete by a stranger reports ok but must not have deleted anything.
    await api.request(`/api/projects/${mine.id}`, { method: "DELETE", headers: { cookie: other.cookie } });
    expect((await api.request(`/api/projects/${mine.id}`, auth(owner.cookie))).status).toBe(200);
  });

  // ── version history ────────────────────────────────────────────────────────
  test("a changed document files the previous one; an unchanged save files nothing", async () => {
    const user = await signIn();
    const p = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc() }, user.cookie))).json();
    const versions = () => api.request(`/api/projects/${p.id}/versions`, auth(user.cookie)).then((r) => r.json());

    expect(await versions()).toEqual([]);
    await api.request(`/api/projects/${p.id}`, send("PUT", { doc: doc({ layers: [] }) }, user.cookie)); // identical
    expect(await versions()).toEqual([]);

    await api.request(`/api/projects/${p.id}`, send("PUT", { doc: doc({ format: "shorts" }) }, user.cookie));
    const list = await versions();
    expect(list).toHaveLength(1);
    expect(list[0].format).toBe("youtube"); // the document that was replaced, not the new one
  });

  test("a rename doesn't spend a version", async () => {
    const user = await signIn();
    const p = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc() }, user.cookie))).json();
    await api.request(`/api/projects/${p.id}`, send("PUT", { name: "Two" }, user.cookie));
    expect(await (await api.request(`/api/projects/${p.id}/versions`, auth(user.cookie))).json()).toEqual([]);
  });

  test("restoring puts the old document back, and is itself undoable", async () => {
    const user = await signIn();
    const p = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc() }, user.cookie))).json();
    await api.request(`/api/projects/${p.id}`, send("PUT", { doc: doc({ format: "shorts" }) }, user.cookie));

    const [v] = await (await api.request(`/api/projects/${p.id}/versions`, auth(user.cookie))).json();
    const restored = await (await api.request(`/api/projects/${p.id}/versions/${v.id}/restore`, send("POST", {}, user.cookie))).json();
    expect(restored.doc.format).toBe("youtube");
    expect((await (await api.request(`/api/projects/${p.id}`, auth(user.cookie))).json()).doc.format).toBe("youtube");

    // The shorts document it replaced is now itself a restore point.
    const after = await (await api.request(`/api/projects/${p.id}/versions`, auth(user.cookie))).json();
    expect(after[0].format).toBe("shorts");
  });

  test("history is capped, keeping the most recent", async () => {
    const user = await signIn();
    const p = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc() }, user.cookie))).json();
    // 32 distinct documents against a limit of 30.
    for (let i = 0; i < 32; i++) {
      await api.request(`/api/projects/${p.id}`, send("PUT", { doc: doc({ background: { mode: "solid", from: `#00000${i % 10}`, to: "#000000", image: null, overlay: i } }) }, user.cookie));
    }
    const list = await (await api.request(`/api/projects/${p.id}/versions`, auth(user.cookie))).json();
    expect(list).toHaveLength(30);
  });

  test("a version id is not a capability — another user can't read or restore it", async () => {
    const owner = await signIn();
    const other = await signIn();
    const p = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc() }, owner.cookie))).json();
    await api.request(`/api/projects/${p.id}`, send("PUT", { doc: doc({ format: "shorts" }) }, owner.cookie));
    const [v] = await (await api.request(`/api/projects/${p.id}/versions`, auth(owner.cookie))).json();

    expect(await (await api.request(`/api/projects/${p.id}/versions`, auth(other.cookie))).json()).toEqual([]);
    expect((await api.request(`/api/projects/${p.id}/versions/${v.id}`, auth(other.cookie))).status).toBe(404);
    expect((await api.request(`/api/projects/${p.id}/versions/${v.id}/restore`, send("POST", {}, other.cookie))).status).toBe(404);
  });

  test("deleting a project takes its history with it", async () => {
    const user = await signIn();
    const p = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc() }, user.cookie))).json();
    await api.request(`/api/projects/${p.id}`, send("PUT", { doc: doc({ format: "shorts" }) }, user.cookie));
    await api.request(`/api/projects/${p.id}`, { method: "DELETE", headers: { cookie: user.cookie } });
    expect(await sql`SELECT 1 FROM project_versions WHERE project_id = ${p.id}`).toHaveLength(0);
  });

  test("images referenced only by an old version are not collected", async () => {
    const user = await signIn();
    const { sweepBlobs } = await import("./maintenance");
    const id = "d".repeat(64);
    await seedBlob(user, id);
    // Past the 24h grace period, so the sweep actually considers it.
    await sql`UPDATE blobs SET created_at = now() - interval '2 days' WHERE id = ${id}`;

    const p = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc({ background: { mode: "image", from: "#000000", to: "#000000", image: `blob:${id}`, overlay: 0 } }) }, user.cookie))).json();
    // Replace it with a document that references nothing: the only mention of those bytes is
    // now the version the save filed.
    await api.request(`/api/projects/${p.id}`, send("PUT", { doc: doc() }, user.cookie));

    // Dry run (BLOB_GC is unset in tests), so this reports what it *would* collect: nothing.
    expect(await sweepBlobs()).toMatchObject({ rows: 0, objects: 0, mode: "dry-run" });
    expect(await sql`SELECT 1 FROM blobs WHERE id = ${id}`).toHaveLength(1);
  });

  // ── campaigns ──────────────────────────────────────────────────────────────
  test("campaignId is tri-state: absent leaves it, null unfiles, an id files", async () => {
    const user = await signIn();
    const camp = await (await api.request("/api/campaigns", send("POST", { name: "Launch" }, user.cookie))).json();
    const p = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc(), campaignId: camp.id }, user.cookie))).json();
    expect(p.campaignId).toBe(camp.id);

    const renamed = await (await api.request(`/api/projects/${p.id}`, send("PUT", { name: "Two" }, user.cookie))).json();
    expect(renamed.campaignId).toBe(camp.id); // key absent → untouched

    const unfiled = await (await api.request(`/api/projects/${p.id}`, send("PUT", { campaignId: null }, user.cookie))).json();
    expect(unfiled.campaignId).toBeNull();
  });

  test("a project can't be filed into someone else's campaign", async () => {
    const owner = await signIn();
    const other = await signIn();
    const camp = await (await api.request("/api/campaigns", send("POST", { name: "Theirs" }, owner.cookie))).json();
    const res = await api.request("/api/projects", send("POST", { name: "One", doc: doc(), campaignId: camp.id }, other.cookie));
    expect(res.status).toBe(404);
  });

  test("deleting a campaign keeps its designs", async () => {
    const user = await signIn();
    const camp = await (await api.request("/api/campaigns", send("POST", { name: "Launch" }, user.cookie))).json();
    const p = await (await api.request("/api/projects", send("POST", { name: "One", doc: doc(), campaignId: camp.id }, user.cookie))).json();
    await api.request(`/api/campaigns/${camp.id}`, { method: "DELETE", headers: { cookie: user.cookie } });

    const after = await (await api.request(`/api/projects/${p.id}`, auth(user.cookie))).json();
    expect(after.campaignId).toBeNull();
  });

  test("the campaign list counts its designs", async () => {
    const user = await signIn();
    const camp = await (await api.request("/api/campaigns", send("POST", { name: "Launch" }, user.cookie))).json();
    await api.request("/api/projects", send("POST", { name: "One", doc: doc(), campaignId: camp.id }, user.cookie));
    await api.request("/api/projects", send("POST", { name: "Two", doc: doc(), campaignId: camp.id }, user.cookie));
    const [row] = await (await api.request("/api/campaigns", auth(user.cookie))).json();
    expect(row.designCount).toBe(2);
  });

  // ── hardening ──────────────────────────────────────────────────────────────
  //
  // The brute-force windows that used to live here left with the password they defended: there
  // is no credential to guess against this API any more, and Clerk owns the one there is. What
  // is still worth bounding is an unauthenticated caller hammering the routes that answer them,
  // which is what the `/auth/me` and `/api/public` limiters do.
  test("an unverified caller runs out of attempts on /auth/me", async () => {
    const attacker = nextIp();
    const knock = () => api.request("/api/auth/me", fromIp({}, attacker));

    let last = await knock();
    for (let i = 0; i < 130 && last.status === 401; i++) last = await knock();
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);

    // …and it's that address that's throttled, not the endpoint: a real session from anywhere
    // else still resolves, which is the half a global limit would have broken.
    expect((await signIn()).id).toBeTruthy();
  });

  test("health fails loudly when the database is unreachable", async () => {
    expect((await api.request("/api/health")).status).toBe(200);
    // Not simulated here — killing the pool would poison every later test. The route's own
    // try/catch is the contract; this asserts the happy path actually touches the database.
  });

  test("the blob reference scan over-matches on purpose", async () => {
    const user = await signIn();
    const { sweepBlobs, collectBlobIds } = await import("./maintenance");
    const [asRef, unknownField, orphan] = ["b".repeat(64), "c".repeat(64), "e".repeat(64)];
    for (const id of [asRef, unknownField, orphan]) await seedBlob(user, id);
    await sql`UPDATE blobs SET created_at = now() - interval '2 days'`;

    // One id as a proper `blob:` ref, one bare in a field the format knows nothing about. The
    // scan matches any 64-hex run, so both count as references — missing one would delete a
    // user's photo, while sparing a stale one costs a few kilobytes.
    await api.request(
      "/api/projects",
      send("POST", { name: "One", doc: doc({ background: { mode: "image", from: "#000000", to: "#000000", image: `blob:${asRef}`, overlay: 0 }, someFutureField: unknownField }) }, user.cookie)
    );

    const swept = await sweepBlobs();
    expect(swept.rows).toBe(1); // the orphan, and only the orphan
    // The pattern itself, checkable directly — it is one string shared with the SQL scan.
    expect(collectBlobIds(`{"src":"blob:${asRef}","x":"${unknownField}"}`)).toEqual(new Set([asRef, unknownField]));
    expect(collectBlobIds(null).size).toBe(0);
  });

  // The arm that actually deletes. It was previously reachable only in production — the mode
  // was read once at import, so no test could enter this branch, and a mistake in its SQL
  // (it batches now) would have been found by a deployment collecting real photos.
  test("armed, the sweep drops the ownership row and the bytes — and spares the shared ones", async () => {
    const user = await signIn();
    const other = await signIn();
    const { sweepBlobs } = await import("./maintenance");
    const [orphan, shared] = ["a".repeat(64), "f".repeat(64)];
    await seedBlob(user, orphan);
    await seedBlob(user, shared);
    await seedBlob(other, shared); // same content, two owners — one R2 object
    await sql`UPDATE blobs SET created_at = now() - interval '2 days'`;
    // `other` still references the shared bytes, so only this user's claim on them is dead.
    await api.request("/api/projects", send("POST", { name: "Theirs", doc: doc({ background: { mode: "image", from: "#000000", to: "#000000", image: `blob:${shared}`, overlay: 0 } }) }, other.cookie));

    process.env.BLOB_GC = "enforce";
    try {
      const swept = await sweepBlobs();
      expect(swept).toMatchObject({ mode: "enforce", rows: 2, objects: 1 });
    } finally {
      delete process.env.BLOB_GC;
    }

    // Both of this user's rows are gone; the other owner's row — and therefore the object — stay.
    expect(await sql`SELECT 1 FROM blobs WHERE user_id = ${user.id}`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM blobs WHERE id = ${shared} AND user_id = ${other.id}`).toHaveLength(1);
    expect(objects.has(shared)).toBe(true);
    expect(objects.has(orphan)).toBe(false);
  });

  // ── public reads (the guest surface) ───────────────────────────────────────
  //
  // The whole security argument for guest mode is that an unauthenticated caller can reach
  // exactly three GETs and nothing else. These are the tests that make that a fact.

  /** A saved project, optionally published. Returns the row the API handed back. */
  async function project(user: Session, name: string, publish: boolean, extra: Record<string, unknown> = {}) {
    const row = await (await api.request("/api/projects", send("POST", { name, doc: doc(extra) }, user.cookie))).json();
    if (publish) await api.request(`/api/projects/${row.id}`, send("PUT", { isPublic: true }, user.cookie));
    return row;
  }

  test("the public list shows published designs and hides everything else", async () => {
    const user = await signIn();
    await project(user, "Published", true);
    await project(user, "Private", false);

    const rows = await (await api.request("/api/public/projects")).json();
    expect(rows.map((r: any) => r.name)).toEqual(["Published"]);
    // Nothing in a public row may identify who owns it.
    expect(Object.keys(rows[0])).not.toContain("user_id");
    expect(Object.keys(rows[0])).not.toContain("userId");
  });

  test("a private project is a 404 to a logged-out caller, published or not by id", async () => {
    const user = await signIn();
    const open = await project(user, "Published", true);
    const shut = await project(user, "Private", false);

    expect((await api.request(`/api/public/projects/${open.id}`)).status).toBe(200);
    // Same answer as an id that doesn't exist — the route never confirms a private one does.
    expect((await api.request(`/api/public/projects/${shut.id}`)).status).toBe(404);
    expect((await api.request(`/api/public/projects/${crypto.randomUUID()}`)).status).toBe(404);
  });

  test("publishing is presence-gated, so a rename can't quietly change it", async () => {
    const user = await signIn();
    const p = await project(user, "One", true);

    await api.request(`/api/projects/${p.id}`, send("PUT", { name: "Renamed" }, user.cookie));
    expect((await api.request(`/api/public/projects/${p.id}`)).status).toBe(200);

    // And false actually means false — `coalesce` couldn't express this, which is why the
    // column is only touched when the key is present.
    const down = await api.request(`/api/projects/${p.id}`, send("PUT", { isPublic: false }, user.cookie));
    expect((await down.json()).isPublic).toBe(false);
    expect((await api.request(`/api/public/projects/${p.id}`)).status).toBe(404);
  });

  test("a new project is private, whoever made it", async () => {
    const user = await signIn();
    // Even when the caller asks for it: POST doesn't read the key at all.
    const row = await (
      await api.request("/api/projects", send("POST", { name: "Sneaky", doc: doc(), isPublic: true }, user.cookie))
    ).json();
    expect(row.isPublic).toBe(false);
    expect((await api.request(`/api/public/projects/${row.id}`)).status).toBe(404);
  });

  test("publishing someone else's project is a 404, and leaves it private", async () => {
    const owner = await signIn();
    const other = await signIn();
    const p = await project(owner, "Mine", false);

    expect((await api.request(`/api/projects/${p.id}`, send("PUT", { isPublic: true }, other.cookie))).status).toBe(404);
    const mine = await (await api.request(`/api/projects/${p.id}`, auth(owner.cookie))).json();
    expect(mine.isPublic).toBe(false);
  });

  /** Records ownership of some bytes under a fixed, readable id — real uploads are addressed
   *  by their own hash, which makes for unreadable assertions. */
  async function seedBlob(user: Session, id: string, contentType = "image/png") {
    await sql`INSERT INTO blobs (id, user_id, content_type, size) VALUES (${id}, ${user.id}, ${contentType}, 3)`;
    objects.set(id, new Uint8Array([1, 2, 3]));
  }

  test("public blobs are scoped to the design that publishes them", async () => {
    const user = await signIn();
    const referenced = "a".repeat(64);
    const elsewhere = "b".repeat(64);
    await seedBlob(user, referenced);
    await seedBlob(user, elsewhere);
    const open = await project(user, "Published", true, {
      background: { mode: "image", from: "#000000", to: "#000000", image: `blob:${referenced}`, overlay: 0 },
    });
    const shut = await project(user, "Private", false);

    const hit = await api.request(`/api/public/projects/${open.id}/blobs/${referenced}`);
    expect(hit.status).toBe(200);
    expect(hit.headers.get("content-type")).toBe("image/png");
    expect(hit.headers.get("cache-control")).toContain("immutable");

    // A blob the public document doesn't mention — the bytes exist and are the same owner's.
    expect((await api.request(`/api/public/projects/${open.id}/blobs/${elsewhere}`)).status).toBe(404);
    // The same blob, asked for through a project that isn't published.
    expect((await api.request(`/api/public/projects/${shut.id}/blobs/${referenced}`)).status).toBe(404);
    // Anything that isn't a blob id, including a LIKE wildcard, is rejected before the query.
    expect((await api.request(`/api/public/projects/${open.id}/blobs/${"%".repeat(64)}`)).status).toBe(404);
  });

  test("a published document can't lend out someone else's bytes", async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const theirs = "c".repeat(64);
    await seedBlob(stranger, theirs);
    // The document names an id the publisher doesn't own. It resolves to nothing — the same
    // rule the authenticated render path applies (see hydrate.ts).
    const p = await project(owner, "Published", true, {
      background: { mode: "image", from: "#000000", to: "#000000", image: `blob:${theirs}`, overlay: 0 },
    });
    expect((await api.request(`/api/public/projects/${p.id}/blobs/${theirs}`)).status).toBe(404);
  });

  test("a published preview is reachable, an unreferenced one is not", async () => {
    const user = await signIn();
    const preview = "d".repeat(64);
    await seedBlob(user, preview, "image/jpeg");
    const p = await project(user, "Published", true);
    await api.request(`/api/projects/${p.id}`, send("PUT", { preview }, user.cookie));

    // The gallery paints its thumbnails through this same route, which is what the `preview =`
    // arm of the check is for: the id is on the row, not inside the document.
    expect((await api.request(`/api/public/projects/${p.id}/blobs/${preview}`)).status).toBe(200);
    expect((await api.request(`/api/public/projects/${p.id}/blobs/${"e".repeat(64)}`)).status).toBe(404);
  });

  test("no credentials means no write, anywhere", async () => {
    const user = await signIn();
    const p = await project(user, "One", true);
    const camp = await (await api.request("/api/campaigns", send("POST", { name: "Launch" }, user.cookie))).json();

    // Every mutating route on the API, called with neither a cookie nor a bearer. This is the
    // assertion that guest mode adds no way to act like an authenticated user: the client-side
    // flag is a courtesy, and this is the rule underneath it.
    const writes: [string, RequestInit][] = [
      ["/api/projects", send("POST", { name: "x", doc: doc() })],
      [`/api/projects/${p.id}`, send("PUT", { name: "x" })],
      [`/api/projects/${p.id}`, send("PUT", { isPublic: false })],
      [`/api/projects/${p.id}`, { method: "DELETE" }],
      [`/api/projects/${p.id}/versions/${crypto.randomUUID()}/restore`, { method: "POST" }],
      ["/api/campaigns", send("POST", { name: "x" })],
      [`/api/campaigns/${camp.id}`, send("PUT", { name: "x" })],
      [`/api/campaigns/${camp.id}`, { method: "DELETE" }],
      ["/api/starred", send("POST", { name: "x", kind: "text", layer: {} })],
      ["/api/tokens", send("POST", { name: "x" })],
      ["/api/blobs", { method: "POST", body: "bytes" }],
    ];
    for (const [path, init] of writes) {
      expect(`${init.method} ${path} → ${(await api.request(path, init)).status}`).toBe(`${init.method} ${path} → 401`);
    }

    // And the reads a guest must not have either.
    for (const path of ["/api/projects", `/api/projects/${p.id}`, "/api/campaigns", "/api/starred", "/api/tokens"]) {
      expect((await api.request(path)).status).toBe(401);
    }
    // …while the published design stays readable, which is the whole point.
    expect((await api.request(`/api/public/projects/${p.id}`)).status).toBe(200);
  });

  test("public reads run out of budget", async () => {
    // 120 per 10 minutes per address (see index.ts). One address, one window.
    const ip = nextIp();
    let last = await api.request("/api/public/projects", fromIp({}, ip));
    for (let i = 0; i < 130 && last.status === 200; i++) last = await api.request("/api/public/projects", fromIp({}, ip));
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
    // A different visitor is unaffected — the bucket is per address, not global.
    expect((await api.request("/api/public/projects", fromIp({}, nextIp()))).status).toBe(200);
  });

  // ── contract ───────────────────────────────────────────────────────────────
  test("a malformed document is refused up front", async () => {
    const user = await signIn();
    const res = await api.request("/api/projects", send("POST", { name: "One", doc: "not a document" }, user.cookie));
    expect(res.status).toBe(400);
  });

  test("the schema is public — it's a spec, not data", async () => {
    const res = await api.request("/api/schema");
    expect(res.status).toBe(200);
    expect((await res.json()).$ref ?? (await res.json()).definitions).toBeDefined();
  });
});
