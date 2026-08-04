/* Thumb Studio service worker — app-shell caching for installability + offline.
   Vite fingerprints built assets, so we cache at runtime (no hard-coded manifest):
   navigations go network-first (fresh deploys win), same-origin static assets are
   served stale-while-revalidate. Cross-origin requests (bg-removal model CDN, fonts
   already inlined by Vite) are left untouched, and so is the API — see the fetch handler.

   The cache name is versioned: `activate` deletes every cache that isn't the current one,
   so bumping it is how a fix to the rules below actually reaches an installed client
   instead of living alongside whatever the old rules had already stored. */
const CACHE = "thumb-studio-v2";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (CDN model, APIs) pass through

  // The API is never cached, and this guard has to come before the stale-while-revalidate
  // branch below — which would otherwise treat every same-origin GET as a static asset.
  // Everything under /api is live state: an archive list, a document, a version history, and
  // `/api/auth/me`, where answering from cache first would hand the editor the *previous*
  // session's identity on a shared browser after a logout. Image bytes (/api/blobs) lose
  // nothing here: they're content-addressed and served `immutable`, so the HTTP cache already
  // keeps them without a copy in Cache Storage.
  if (url.pathname.startsWith("/api/")) return;

  // App navigations: network-first so a new deploy is picked up, cache as offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
