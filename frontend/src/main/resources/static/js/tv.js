/*
 * Pantalla TV: reloj, pantalla completa, sonido y voz al llamar un turno, y destello del llamado nuevo.
 * El contenido lo refresca htmx con cada evento del local; este archivo solo agrega lo que necesita el navegador.
 */
(function () {
  "use strict";

  var reloj = document.getElementById("tv-reloj");
  var formato = new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima", hour12: false });
  function tic() {
    if (reloj) reloj.textContent = formato.format(new Date());
  }
  setInterval(tic, 10000);
  tic();

  // PIN de presencia de las citas (M3), solo si la pantalla se abrió con el enlace firmado
  var pin = document.getElementById("tv-pin");
  if (pin) {
    var cargarPin = function () {
      fetch(pin.getAttribute("data-pin-url"), { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (b) {
          var d = b && b.ok ? b.data : null;
          pin.hidden = !d;
          if (d) pin.querySelector("b").textContent = d.pin;
        })
        .catch(function () { pin.hidden = true; });
    };
    cargarPin();
    setInterval(cargarPin, 30000);
  }

  var conSonido = window.Sonido.interruptor(document.getElementById("tv-sonido"), "turnoya:tv:sonido");

  var completa = document.getElementById("tv-completa");
  if (completa) {
    completa.addEventListener("click", function () {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    });
  }

  // Cada "turno:llamado" del canal: timbre + voz y destello cuando llega el contenido nuevo
  var destellar = false;
  document.addEventListener("htmx:sseMessage", function (e) {
    if (!e.detail || e.detail.type !== "turno:llamado") return;
    var turno;
    try {
      turno = JSON.parse(e.detail.data).turno;
    } catch (ignorado) { return; /* evento sin datos */ }
    // Pantalla de una sala: los llamados de otras colas no suenan ni destellan aquí
    var colas = [].map.call(document.querySelectorAll("[data-tv-cola]"), function (c) { return c.getAttribute("data-tv-cola"); });
    if (colas.length && colas.indexOf(turno.cola) === -1) return;
    destellar = true;
    if (!conSonido()) return;
    try {
      window.Sonido.timbre();
      setTimeout(function () {
        window.Sonido.hablar("Turno " + window.Sonido.deletrear(turno.codigo) + ", " + turno.ventanilla);
      }, 700);
    } catch (ignorado) { /* evento sin datos */ }
  });

  document.addEventListener("htmx:afterSwap", function () {
    if (!destellar) return;
    destellar = false;
    var llamado = document.querySelector(".tv-llamado");
    if (!llamado) return;
    llamado.classList.add("destello");
    setTimeout(function () { llamado.classList.remove("destello"); }, 4000);
  });
})();
