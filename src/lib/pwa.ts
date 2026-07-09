/** Register the service worker so the app is installable and works offline.
    Only in production builds — the dev server must not be shadowed by a cache. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failure is non-fatal — the app still runs online.
    });
  });
}
