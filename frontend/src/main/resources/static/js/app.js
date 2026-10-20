/*
 * TurnoYa — comportamiento común de todas las páginas (sin dependencias, sin compilación).
 *  - Envía el token CSRF en cada petición de htmx.
 *  - Muestra los avisos que manda el servidor (cabecera HX-Trigger: {"aviso": {tipo, mensaje}}).
 *  - Abre y cierra diálogos nativos (<dialog>) con data-abrir="id" / data-cerrar.
 *  - Envía un formulario al cambiar un selector marcado con data-autoenviar.
 *  - Limpia los formularios marcados con data-limpiar-al-enviar después de un envío correcto.
 *  - Refleja el estado de la conexión en vivo (SSE) en los indicadores .en-vivo.
 */
(function () {
  "use strict";

  function meta(nombre) {
    var m = document.querySelector('meta[name="' + nombre + '"]');
    return m ? m.content : null;
  }

  // --- Avisos flotantes ---------------------------------------------------
  function contenedorAvisos() {
    var c = document.getElementById("avisos");
    if (!c) {
      c = document.createElement("div");
      c.id = "avisos";
      c.className = "avisos";
      c.setAttribute("aria-live", "polite");
      document.body.appendChild(c);
    }
    return c;
  }

  function aviso(tipo, mensaje) {
    if (!mensaje) return;
    var el = document.createElement("div");
    el.className = "aviso-flotante " + (tipo || "info");
    el.setAttribute("role", tipo === "error" ? "alert" : "status");
    el.textContent = mensaje;
    contenedorAvisos().appendChild(el);
    setTimeout(function () {
      el.classList.add("saliendo");
      setTimeout(function () { el.remove(); }, 250);
    }, tipo === "error" ? 6000 : 3500);
  }

  // --- htmx ---------------------------------------------------------------
  document.addEventListener("htmx:configRequest", function (e) {
    var token = meta("_csrf");
    var cabecera = meta("_csrf_header");
    if (token && cabecera) e.detail.headers[cabecera] = token;
  });

  document.addEventListener("aviso", function (e) {
    aviso(e.detail.tipo, e.detail.mensaje);
  });

  document.addEventListener("abrirVentana", function (e) {
    window.open(e.detail.value, "_blank", "width=420,height=640");
  });

  // Errores: si el servidor mandó un aviso se muestra; si no, uno genérico
  document.addEventListener("htmx:responseError", function (e) {
    var cabecera = e.detail.xhr.getResponseHeader("HX-Trigger");
    if (cabecera) {
      try {
        var datos = JSON.parse(cabecera);
        if (datos.aviso) return aviso(datos.aviso.tipo, datos.aviso.mensaje);
      } catch (ignorado) { /* cabecera no JSON */ }
    }
    if (e.detail.xhr.status === 401) return;
    aviso("error", "Ocurrió un error. Inténtalo de nuevo.");
  });

  document.addEventListener("htmx:sendError", function () {
    aviso("error", "Sin conexión con el servidor");
  });

  // Tras un envío correcto: el diálogo que contenía el formulario se cierra y los formularios
  // marcados con data-limpiar-al-enviar quedan vacíos para el siguiente registro
  document.addEventListener("htmx:afterRequest", function (e) {
    if (!e.detail.successful) return;
    if (e.detail.elt && e.detail.elt.matches && e.detail.elt.matches("form[data-limpiar-al-enviar]")) e.detail.elt.reset();
    var dialogo = e.detail.elt && e.detail.elt.closest ? e.detail.elt.closest("dialog") : null;
    if (dialogo && dialogo.open) dialogo.close();
  });

  // --- Conexión en vivo -----------------------------------------------------
  function marcarConexion(estado) {
    document.querySelectorAll(".en-vivo").forEach(function (el) {
      el.classList.remove("conectado", "desconectado");
      el.classList.add(estado);
      var texto = el.querySelector(".en-vivo-texto");
      if (texto) texto.textContent = estado === "conectado" ? "En vivo" : "Reconectando…";
    });
  }
  document.addEventListener("htmx:sseOpen", function () { marcarConexion("conectado"); });
  document.addEventListener("htmx:sseError", function () { marcarConexion("desconectado"); });

  // --- Diálogos y formularios ---------------------------------------------
  document.addEventListener("click", function (e) {
    var abrir = e.target.closest("[data-abrir]");
    if (abrir) {
      var dialogo = document.getElementById(abrir.getAttribute("data-abrir"));
      if (dialogo && dialogo.showModal) dialogo.showModal();
      return;
    }
    var cerrar = e.target.closest("[data-cerrar]");
    if (cerrar) {
      var d = cerrar.closest("dialog");
      if (d) d.close();
    }
  });

  document.addEventListener("change", function (e) {
    if (e.target.matches("[data-autoenviar]") && e.target.form) e.target.form.requestSubmit();
  });

  window.TurnoYa = { aviso: aviso };
})();
