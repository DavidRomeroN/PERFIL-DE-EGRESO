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
    destellar = true;
    if (!conSonido()) return;
    try {
      var turno = JSON.parse(e.detail.data).turno;
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
