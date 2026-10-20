/* Ticket impreso: abre el diálogo de impresión al cargar y atiende los botones Imprimir / Cerrar. */
(function () {
  "use strict";
  var imprimir = document.getElementById("ticket-imprimir");
  var cerrar = document.getElementById("ticket-cerrar");
  if (imprimir) imprimir.addEventListener("click", function () { window.print(); });
  if (cerrar) cerrar.addEventListener("click", function () { window.close(); });
  setTimeout(function () { window.print(); }, 600);
})();
