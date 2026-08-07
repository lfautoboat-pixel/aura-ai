// v2 — network-first for the app shell (HTML/JS/CSS) so users never get stuck
// on stale code after a deploy; cache is an offline fallback, not the source
// of truth. Only truly static assets (images/fonts) are cache-first.
const CACHE = "aura-v2";
const STATIC_ASSETS = ["/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return /\.(png|jpg|jpeg|svg|webp|ico|woff2?|ttf)$/.test(url.pathname);
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url)) {
    // Cache-first: these are content-hashed or rarely change.
    e.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Network-first for everything else (HTML, JS, CSS): always try to get the
  // latest deployed code; only fall back to cache when truly offline.
  e.respondWith(
    fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match("/index.html")))
  );
});

self.addEventListener("push", (e) => {
  let payload = { title: "Aura AI", body: "", url: "/app" };
  try { payload = { ...payload, ...e.data.json() }; } catch (err) { /* non-JSON push, use defaults */ }
  e.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/app";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) { existing.focus(); return existing.navigate(url); }
      return self.clients.openWindow(url);
    })
  );
});
