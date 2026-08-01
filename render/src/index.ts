// Headless renderer — turns a ThumbDoc into a PNG without a person in front of a browser.
//
// Why a browser at all: the design is HTML. Text wrapping, the font metrics, the WebGL effect
// backgrounds, the SVG filters behind image glow — all of it is the browser's work, and the
// editor's own export is a screenshot of exactly that. A second renderer (satori, resvg, a
// canvas reimplementation) would be a second opinion about what the design looks like, and
// the two would drift the first time anyone touched ThumbCanvas. So: the real page, the real
// canvas component, one Chromium.
//
// The service is deliberately dumb. It holds no credentials, reaches no database, and knows
// nothing about projects or users — it takes a document, returns a picture. `api` is the only
// thing that talks to it, and only after authenticating the caller itself.

import { Hono } from "hono";
import { chromium, type Browser, type Page } from "playwright-core";

/** Where the built SPA is served from — `web` (nginx) in Compose. */
const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://web";
const PORT = Number(process.env.PORT ?? 3002);
/** A render that hasn't finished by now is wedged; fail it rather than pile up. */
const RENDER_TIMEOUT_MS = 30_000;

const app = new Hono();

// ── the browser ─────────────────────────────────────────────────────────────
//
// One browser and one page for the life of the process. Booting Chromium takes ~300ms and
// loading the render bundle (fonts included) takes more, so doing it per request would make
// every render feel broken. The page is stateless between renders — __renderThumb replaces
// the whole tree — so reuse is safe as long as renders don't overlap, which the queue below
// guarantees.

let browser: Browser | null = null;
let page: Page | null = null;

async function ensurePage(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      args: [
        // The container is the sandbox, and this service never navigates anywhere but our
        // own origin.
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--force-color-profile=srgb",
        // Software WebGL, pinned. The effect backgrounds are ogl shaders, and a Chromium
        // with no GL context draws them as a black rectangle with the layers fine on top —
        // silently, since nothing throws. The Playwright base image already resolves WebGL
        // to SwiftShader without this flag (checked), so it is insurance against a future
        // base that doesn't, and the first place to look if effects come back black.
        "--use-angle=swiftshader",
      ],
    });
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    // Motion in a still is just a coin flip about which frame you get.
    reducedMotion: "reduce",
  });
  const fresh = await context.newPage();
  fresh.on("console", (m) => {
    if (m.type() === "error") console.warn("[render:page]", m.text());
  });
  await fresh.goto(`${APP_ORIGIN}/render.html`, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
  await fresh.waitForFunction("typeof window.__renderThumb === 'function'", null, { timeout: RENDER_TIMEOUT_MS });
  page = fresh;
  return fresh;
}

// One page means one render at a time. Requests queue instead of racing; a campaign's worth
// of renders is a handful, and serialising them is cheaper than running several Chromiums.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.catch(() => {});
  return run;
}

async function renderDoc(doc: unknown): Promise<Buffer> {
  const p = await ensurePage();
  const size = await p.evaluate((d) => window.__renderThumb(d as never), doc);
  const stage = p.locator("#stage");
  await p.setViewportSize({ width: size.w, height: size.h });
  return stage.screenshot({ type: "png", animations: "disabled", timeout: RENDER_TIMEOUT_MS });
}

// ── routes ──────────────────────────────────────────────────────────────────
app.post("/render", async (c) => {
  const body = await c.req.json().catch(() => null);
  const doc = (body as { doc?: unknown } | null)?.doc;
  if (!doc || typeof doc !== "object") return c.json({ error: "body must be { doc: ThumbDoc }" }, 400);

  try {
    const png = await serialize(() => renderDoc(doc));
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (err) {
    // A page that has died (OOM, crash) must not poison every later request: drop it and let
    // the next call build a fresh one.
    console.warn("[render] failed", err);
    await page?.close().catch(() => {});
    page = null;
    return c.json({ error: "render failed", detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Health means "a browser can render", not "the process is up" — a wedged Chromium is the
// failure this service actually has.
app.get("/health", async (c) => {
  try {
    const p = await ensurePage();
    return c.json({ ok: !p.isClosed() });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 503);
  }
});

declare global {
  interface Window {
    __renderThumb: (doc: unknown) => Promise<{ w: number; h: number }>;
  }
}

console.log(`[render] serving on :${PORT}, rendering ${APP_ORIGIN}/render.html`);
export default { port: PORT, fetch: app.fetch, idleTimeout: 60 };
