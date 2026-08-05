const CACHE = "aura-v1";
const ASSETS = ["/", "/index.html", "/manifest.json"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET" || request.url.includes("/api/")) return;
  e.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("/index.html")))
  );
});
