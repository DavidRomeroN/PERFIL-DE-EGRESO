/* M5 · Ticket provisional: consulta cada 10 s y redirige al turno definitivo apenas el kiosco sincroniza. */
(function () {
  "use strict";
  var caja = document.querySelector("[data-provisional]");
  if (!caja) return;
  var url = caja.getAttribute("data-provisional");
  function revisar() {
    fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (b) {
        var d = b && b.data;
        if (!d) return;
        if (d.estado === "LISTO" && d.token) { location.replace("/t/" + encodeURIComponent(d.token)); return; }
        var revision = d.estado === "REVISION";
        caja.querySelector("[data-revision]").hidden = !revision;
        caja.querySelector("[data-pendiente]").hidden = revision;
        caja.classList.toggle("en-revision", revision);
      })
      .catch(function () { /* se reintenta */ });
  }
  revisar();
  setInterval(revisar, 10000);
})();
