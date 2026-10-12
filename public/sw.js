const CACHE = "turnoya-kiosco-v1";
const PRECACHE = ["/kiosco", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    fetch(req).then((res) => {
      const copia = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copia)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match("/kiosco"))),
  );
});
