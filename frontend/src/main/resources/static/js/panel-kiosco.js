/*
 * Panel de kiosco (recepción): abre el diálogo del ticket con la cola tocada y el de transferir con el turno elegido.
 * Los diálogos están fuera del contenido que se refresca, así que se rellenan aquí antes de abrirlos.
 */
(function () {
  "use strict";

  document.addEventListener("click", function (e) {
    var cola = e.target.closest("[data-ticket-cola]");
    if (cola) {
      var dialogo = document.getElementById("dialogo-ticket");
      dialogo.querySelector("[data-campo-cola]").value = cola.getAttribute("data-cola-id");
      dialogo.querySelector("[data-cola-elegida]").textContent = cola.getAttribute("data-cola-nombre");
      dialogo.showModal();
      var nombre = dialogo.querySelector("input[name=nombre]");
      if (nombre) nombre.focus();
      return;
    }

    var transferir = e.target.closest("[data-transferir]");
    if (transferir) {
      var d = document.getElementById("dialogo-transferir");
      var origen = transferir.getAttribute("data-cola-id");
      d.querySelector("[data-campo-turno]").value = transferir.getAttribute("data-turno-id");
      d.querySelector("[data-turno-elegido]").textContent = transferir.getAttribute("data-turno-codigo");
      // La cola donde ya está no se ofrece como destino
      var destino = d.querySelector("[data-campo-destino]");
      var primera = null;
      Array.prototype.forEach.call(destino.options, function (o) {
        var misma = o.value === origen;
        o.disabled = misma;
        o.hidden = misma;
        if (!misma && primera === null) primera = o.value;
      });
      if (primera !== null) destino.value = primera;
      d.showModal();
    }
  });
})();
