// Fast Traffic OS service worker.
// Network-first for navigation (always fresh app shell when online),
// with a tiny cache so the app remains installable and resilient offline.
const CACHE = "fts-os-v1";
const APP_SHELL = ["/app"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never cache API/auth/storage traffic — always go to network.
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/manus-storage") ||
    url.pathname.startsWith("/__manus__")
  ) {
    return;
  }

  // App navigations: network-first, fall back to cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/app", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/app").then((r) => r || Response.error())),
    );
    return;
  }

  // Static assets: cache-first with background refresh.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
