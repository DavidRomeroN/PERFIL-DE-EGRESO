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

  // M2 · "avisarme X min antes" (opt-in) y mejores horas para venir hoy.
  var csrf = document.querySelector('meta[name="_csrf"]');
  var csrfHeader = document.querySelector('meta[name="_csrf_header"]');
  var horasCache = null;

  document.addEventListener("click", function (e) {
    var boton = e.target.closest("[data-aviso-min]");
    if (!boton) return;
    var caja = boton.closest(".extra-espera");
    var valor = boton.getAttribute("data-aviso-min");
    var cabeceras = { "Content-Type": "application/json" };
    if (csrf && csrfHeader) cabeceras[csrfHeader.content] = csrf.content;
    fetch("/api/v1/public/turnos/" + encodeURIComponent(caja.getAttribute("data-token")) + "/aviso", {
      method: "PATCH", headers: cabeceras, body: JSON.stringify({ minAntes: valor ? Number(valor) : null })
    }).then(function (r) { return r.json(); }).then(function (r) {
      if (!r.ok) throw new Error(r.error && r.error.mensaje);
      caja.querySelectorAll("[data-aviso-min]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === boton)); });
      if (window.TurnoYa) window.TurnoYa.aviso("exito", valor ? "Te avisaremos cuando falten unos " + valor + " min" : "Aviso por tiempo desactivado");
    }).catch(function (err) {
      if (window.TurnoYa) window.TurnoYa.aviso("error", (err && err.message) || "No se pudo guardar el aviso");
    });
  });

  function pintarHoras() {
    var caja = document.querySelector("[data-mejores-horas]");
    if (!caja || !horasCache || !horasCache.length) return;
    var lista = caja.querySelector("ul");
    lista.textContent = "";
    horasCache.slice(0, 8).forEach(function (h) {
      var li = document.createElement("li");
      li.className = "franja-espera nivel-" + h.nivel;
      li.textContent = h.franja + " · ~" + h.esperaMin + " min";
      lista.appendChild(li);
    });
    caja.hidden = false;
  }

  var extra = document.querySelector(".extra-espera");
  if (extra) {
    fetch("/api/v1/public/colas/" + encodeURIComponent(extra.getAttribute("data-cola")) + "/mejores-horas")
      .then(function (r) { return r.json(); })
      .then(function (r) { if (r.ok) { horasCache = r.data; pintarHoras(); } })
      .catch(function () { /* opcional */ });
  }
  document.addEventListener("htmx:afterSwap", pintarHoras);

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
