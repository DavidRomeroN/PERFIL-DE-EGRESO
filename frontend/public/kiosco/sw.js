/*
 * M5 · Service Worker del kiosco. Alcance SOLO /kiosco (D2): no toca el panel, el admin ni /api.
 * Precarga el shell del kiosco; los GET de navegación de /kiosco usan red primero y caché como respaldo.
 * Nunca guarda respuestas de la API (datos de sesión ni turnos) ni peticiones POST.
 */
const VERSION = "turnoya-kiosco-v2";
const SHELL = ["/kiosco", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const esShell = url.pathname === "/kiosco" || url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg";
  if (!esShell) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/kiosco"))),
  );
});

// Background Sync: la página registra "kiosco-sync"; aquí solo se avisa a las pestañas abiertas para que sincronicen
self.addEventListener("sync", (event) => {
  if (event.tag === "kiosco-sync") {
    event.waitUntil(self.clients.matchAll().then((cs) => cs.forEach((c) => c.postMessage({ tipo: "sync" }))));
  }
});
