/*
 * Panel de ventanilla: cronómetros en vivo y timbre al llamar. Todo lo demás (llamar, atender, ticket) lo hace el
 * servidor y htmx reemplaza el panel.
 *   [data-desde="ISO"]               mm:ss desde el llamado; con data-limite (s) marca .excedido (RN04)
 *   [data-espera-desde="ISO"]        tiempo en espera ("3 min")
 */
(function () {
  "use strict";

  function segundosDesde(iso) {
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  }

  function duracion(seg) {
    var min = Math.round(seg / 60);
    if (min < 1) return "< 1 min";
    if (min < 60) return min + " min";
    var h = Math.floor(min / 60);
    var m = min % 60;
    return m ? h + " h " + m + " min" : h + " h";
  }

  function actualizar() {
    document.querySelectorAll("[data-desde]").forEach(function (el) {
      var s = segundosDesde(el.getAttribute("data-desde"));
      el.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      var limite = Number(el.getAttribute("data-limite"));
      var excedido = limite > 0 && s >= limite;
      el.classList.toggle("excedido", excedido);
      var tarjeta = el.closest(".turno-actual");
      if (tarjeta) tarjeta.classList.toggle("excedido", excedido);
    });
    document.querySelectorAll("[data-espera-desde]").forEach(function (el) {
      el.textContent = duracion(segundosDesde(el.getAttribute("data-espera-desde")));
    });
  }

  document.addEventListener("sonido", function () {
    if (window.Sonido) window.Sonido.timbre();
  });
  document.addEventListener("htmx:afterSwap", actualizar);
  setInterval(actualizar, 1000);
  actualizar();
})();
