/*
 * M5 · Service worker del kiosco. Alcance SOLO /kiosco: no toca el panel, el admin ni /api.
 * Precarga la página del kiosco con sus estilos y su script; navegación de /kiosco con red primero y caché de respaldo.
 * Nunca guarda respuestas de la API ni peticiones POST.
 */
var VERSION = "turnoya-kiosco-java-1";
var SHELL = ["/kiosco", "/css/app.css", "/js/kiosco.js", "/js/app.js", "/js/sonido.js", "/img/icono.svg"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf("/api/") === 0) return;
  var esShell = SHELL.indexOf(url.pathname) >= 0 || url.pathname.indexOf("/css/") === 0 || url.pathname.indexOf("/webjars/") === 0;
  if (!esShell) return;
  event.respondWith(
    fetch(req).then(function (res) {
      if (res.ok) {
        var copia = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copia); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match("/kiosco"); });
    })
  );
});
