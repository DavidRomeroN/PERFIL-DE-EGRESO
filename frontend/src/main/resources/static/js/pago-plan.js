/*
 * TurnoYa — pago del plan con tarjeta (Mercado Pago, Card Payment Brick).
 * El formulario de tarjeta lo dibuja Mercado Pago dentro de #mp-brick y tokeniza la tarjeta en el navegador con la
 * clave pública. El cobro lo hace el servidor (POST /api/v1/pagos/plan) con el monto del plan, nunca el navegador.
 */
(function () {
  "use strict";

  var form = document.getElementById("pago-plan");
  if (!form) return;

  var clavePublica = form.getAttribute("data-clave-publica") || "";
  var habilitado = form.getAttribute("data-habilitado") === "true";
  var detalle = form.querySelector("[data-pago-detalle]");
  var total = form.querySelector("[data-pago-total]");
  var error = form.querySelector("[data-pago-error]");
  var meses = form.querySelector("#meses");
  var controlador = null;
  var cargaSdk = null;

  function aviso(tipo, mensaje) {
    if (window.TurnoYa) window.TurnoYa.aviso(tipo, mensaje);
  }

  function mostrarError(mensaje) {
    error.textContent = mensaje || "";
    error.hidden = !mensaje;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function cargarSdk() {
    if (window.MercadoPago) return Promise.resolve();
    if (!cargaSdk) {
      cargaSdk = new Promise(function (ok, mal) {
        var s = document.createElement("script");
        s.src = "https://sdk.mercadopago.com/js/v2";
        s.async = true;
        s.onload = ok;
        s.onerror = function () {
          cargaSdk = null;
          mal(new Error("No se pudo cargar el formulario de pago de Mercado Pago"));
        };
        document.head.appendChild(s);
      });
    }
    return cargaSdk;
  }

  function seleccion() {
    var r = form.querySelector('input[name="plan"]:checked');
    return r ? { codigo: r.value, precio: Number(r.getAttribute("data-precio")) } : null;
  }

  function desmontar() {
    if (controlador) {
      try { controlador.unmount(); } catch (ignorado) { /* ya desmontado */ }
      controlador = null;
    }
  }

  function montar() {
    var plan = seleccion();
    desmontar();
    mostrarError("");
    if (!plan) {
      detalle.hidden = true;
      return;
    }
    detalle.hidden = false;
    var monto = plan.precio * Number(meses.value);
    total.textContent = monto.toFixed(2);
    if (!habilitado || !clavePublica) {
      mostrarError("Los pagos con tarjeta no están configurados en el servidor.");
      return;
    }
    var claveIdem = uuid();
    cargarSdk().then(function () {
      var mp = new window.MercadoPago(clavePublica, { locale: "es-PE" });
      return mp.bricks().create("cardPayment", "mp-brick", {
        initialization: { amount: monto },
        customization: { paymentMethods: { maxInstallments: 1 } },
        callbacks: {
          onReady: function () {},
          onError: function (e) { mostrarError((e && e.message) || "Error en el formulario de pago"); },
          onSubmit: function (tarjeta) { return pagar(plan.codigo, Number(meses.value), claveIdem, tarjeta); }
        }
      });
    }).then(function (c) { controlador = c; }).catch(function (e) { mostrarError(e.message); });
  }

  function pagar(plan, nMeses, claveIdem, tarjeta) {
    return fetch("/api/v1/pagos/plan", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: plan, meses: nMeses, claveIdem: claveIdem, tarjeta: tarjeta })
    }).then(function (r) { return r.json(); }).then(function (cuerpo) {
      if (!cuerpo.ok) throw new Error(cuerpo.error ? cuerpo.error.mensaje : "No se pudo procesar el pago");
      var r = cuerpo.data;
      if (r.estado === "RECHAZADO" || r.estado === "CANCELADO") throw new Error(r.mensaje);
      aviso("exito", r.mensaje);
      setTimeout(function () { window.location.reload(); }, 1500);
    }).catch(function (e) {
      mostrarError(e.message);
      aviso("error", e.message);
      // Una nueva clave de idempotencia para el siguiente intento
      montar();
      throw e;
    });
  }

  form.addEventListener("change", function (e) {
    if (e.target.name === "plan" || e.target === meses) montar();
  });
  form.querySelector("[data-pago-cancelar]").addEventListener("click", function () {
    form.querySelectorAll('input[name="plan"]').forEach(function (r) { r.checked = false; });
    montar();
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); });
})();
