// Sharmyn service worker — caches the static app shell for offline/flaky-network
// resilience. Never touches /api/* (products, prices, orders always come from the
// network — this is a boutique storefront, stale stock/pricing is worse than a
// failed request).
//
// __BUILD_ID__ is stamped in at build time (scripts/stamp-sw-version.js) — a
// fixed literal here meant every deploy reused the exact same cache name, so
// the cleanup below never actually ran and a device that ever hit one failed
// network request on a page load could stay pinned to whatever shell got
// cached that day, indefinitely, with no visible sign anything was stale.
const CACHE = "sharmyn-shell-__BUILD_ID__";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache live data

  // Navigations: try the network first (fresh app shell), fall back to cache
  // when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((res) => res || caches.match("/")))
    );
    return;
  }

  // Static assets (hashed JS/CSS/images/fonts): cache-first, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
