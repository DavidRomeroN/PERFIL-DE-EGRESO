/*
 * "Mi turno": avisa con vibración (y sonido + voz si el cliente lo activó) cuando su turno es llamado o está
 * por llegar, comparte el enlace y sigue al turno nuevo si fue transferido.
 */
(function () {
  "use strict";

  var conSonido = window.Sonido.interruptor(document.getElementById("mi-turno-sonido"), "turnoya:mi-turno:sonido");
  var tarjeta = document.getElementById("tarjeta");
  var estadoPrevio = tarjeta ? tarjeta.getAttribute("data-estado") : null;

  document.addEventListener("htmx:afterSwap", function () {
    var nueva = document.getElementById("tarjeta");
    if (!nueva) return;
    var redirigir = nueva.getAttribute("data-redirigir");
    if (redirigir) {
      window.location.replace(redirigir);
      return;
    }
    var estado = nueva.getAttribute("data-estado");
    if (estado === "LLAMADO" && estadoPrevio !== "LLAMADO") {
      window.Sonido.vibrar();
      if (conSonido()) {
        window.Sonido.timbre();
        var ventanilla = nueva.getAttribute("data-ventanilla") || "la ventanilla";
        window.Sonido.hablar("Turno " + window.Sonido.deletrear(nueva.getAttribute("data-codigo")) + ". Acércate a " + ventanilla + ".");
      }
      if (window.TurnoYa) window.TurnoYa.aviso("exito", "Es tu turno. Acércate a " + (nueva.getAttribute("data-ventanilla") || "la ventanilla"));
    } else if (estado === "AVISADO" && estadoPrevio === "EMITIDO") {
      window.Sonido.vibrar();
      if (conSonido()) window.Sonido.timbre();
    }
    estadoPrevio = estado;
  });

  var compartir = document.getElementById("mi-turno-compartir");
  if (compartir) {
    compartir.addEventListener("click", function () {
      var url = window.location.href;
      var titulo = compartir.getAttribute("data-titulo");
      if (navigator.share) {
        navigator.share({ title: titulo, text: titulo, url: url }).catch(function () { /* cancelado */ });
        return;
      }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          if (window.TurnoYa) window.TurnoYa.aviso("exito", "Enlace copiado");
        });
      }
    });
  }
})();
