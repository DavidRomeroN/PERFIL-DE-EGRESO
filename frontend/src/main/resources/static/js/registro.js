/*
 * TurnoYa — alta de un local (/registro).
 * Plan gratuito: envía los datos y el local queda creado. Plan de pago: muestra el Card Payment Brick de Mercado Pago,
 * que tokeniza la tarjeta en el navegador; el cobro lo hace el servidor (POST /api/v1/public/registro) con el precio
 * del plan. Si el pago queda en revisión se consulta su estado cada 5 s.
 */
(function () {
  "use strict";

  var raiz = document.getElementById("registro");
  if (!raiz) return;

  var form = document.getElementById("form-registro");
  var clavePublica = raiz.getAttribute("data-clave-publica") || "";
  var habilitado = raiz.getAttribute("data-habilitado") === "true";
  var pasos = raiz.querySelectorAll("[data-paso]");
  var errorDatos = raiz.querySelector("[data-registro-error]");
  var errorPago = raiz.querySelector("[data-pago-error]");
  var botonEnviar = raiz.querySelector("[data-registro-enviar]");
  var slug = document.getElementById("slug");
  var nombre = document.getElementById("nombreComercial");
  var slugEditado = false;
  var clave = uuid();
  var controlador = null;
  var cargaSdk = null;
  var sondeo = null;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function mostrar(paso) {
    pasos.forEach(function (s) { s.hidden = s.getAttribute("data-paso") !== paso; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function error(el, mensaje) {
    el.textContent = mensaje || "";
    el.hidden = !mensaje;
  }

  function plan() {
    var r = form.querySelector('input[name="plan"]:checked');
    return r ? { codigo: r.value, precio: Number(r.getAttribute("data-precio")), nombre: r.getAttribute("data-nombre") } : null;
  }

  function aSlug(texto) {
    return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  }

  function actualizarPlan() {
    var p = plan();
    var gratis = !p || p.precio === 0;
    botonEnviar.textContent = gratis ? "Crear mi local gratis" : "Continuar al pago";
    raiz.querySelector("[data-aviso-cobro]").textContent = gratis ? "" : " Se cobrará S/ " + p.precio.toFixed(2) + " por el primer mes.";
  }

  function datos(tarjeta) {
    var f = new FormData(form);
    return {
      plan: f.get("plan"),
      nombreComercial: f.get("nombreComercial"),
      razonSocial: f.get("razonSocial"),
      ruc: f.get("ruc") || null,
      rubro: f.get("rubro"),
      ciudad: f.get("ciudad"),
      direccion: f.get("direccion") || null,
      telefono: f.get("telefono") || null,
      slug: f.get("slug"),
      adminNombre: f.get("adminNombre"),
      adminEmail: f.get("adminEmail"),
      password: f.get("password"),
      aceptaTerminos: f.get("aceptaTerminos") === "true",
      claveIdem: clave,
      tarjeta: tarjeta || null
    };
  }

  function enviar(tarjeta) {
    return fetch("/api/v1/public/registro", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos(tarjeta))
    }).then(function (r) { return r.json(); }).then(function (cuerpo) {
      if (!cuerpo.ok) {
        var e = new Error(cuerpo.error ? cuerpo.error.mensaje : "No se pudo completar el registro");
        e.codigo = cuerpo.error && cuerpo.error.codigo;
        throw e;
      }
      if (cuerpo.data.estado === "RECHAZADO" || cuerpo.data.estado === "CANCELADO") throw new Error(cuerpo.data.mensaje);
      listo(cuerpo.data);
    }).catch(function (e) {
      clave = uuid(); // un reintento es un cobro nuevo, no el mismo intento rechazado
      if (["SLUG_OCUPADO", "EMAIL_OCUPADO", "VALIDACION", "RATE_LIMIT"].indexOf(e.codigo) >= 0 || !tarjeta) {
        desmontar();
        mostrar("datos");
        error(errorDatos, e.message);
      } else {
        error(errorPago, e.message);
      }
      throw e;
    });
  }

  function listo(r) {
    desmontar();
    var aprobado = r.estado === "APROBADO";
    raiz.querySelector("[data-listo-titulo]").textContent = aprobado ? "¡Tu local está listo!" : "Pago en revisión";
    raiz.querySelector("[data-listo-mensaje]").textContent = r.mensaje;
    raiz.querySelector("[data-icono-listo]").textContent = aprobado ? "✓" : "…";
    raiz.querySelector("[data-icono-listo]").classList.toggle("en-revision", !aprobado);
    raiz.querySelector("[data-listo-acciones]").hidden = !aprobado;
    var email = document.getElementById("adminEmail").value;
    raiz.querySelector("[data-ingresar]").href = "/login?email=" + encodeURIComponent(email) + "&next=/admin";
    var enlace = raiz.querySelector("[data-listo-slug]");
    if (aprobado && r.slug) {
      var a = raiz.querySelector("[data-enlace-local]");
      a.href = "/l/" + r.slug;
      a.textContent = "/l/" + r.slug;
      enlace.hidden = false;
    }
    mostrar("listo");
    if (!aprobado && r.pagoId && !sondeo) {
      var pagoId = r.pagoId, claveUsada = clave;
      sondeo = setInterval(function () {
        fetch("/api/v1/public/pagos/" + pagoId + "?clave=" + encodeURIComponent(claveUsada), { credentials: "same-origin" })
          .then(function (x) { return x.json(); })
          .then(function (c) {
            if (c.ok && c.data.estado !== r.estado) {
              clearInterval(sondeo);
              sondeo = null;
              listo(c.data);
            }
          }).catch(function () { /* se reintenta en el siguiente ciclo */ });
      }, 5000);
    }
  }

  function cargarSdk() {
    if (window.MercadoPago) return Promise.resolve();
    if (!cargaSdk) {
      cargaSdk = new Promise(function (ok, mal) {
        var s = document.createElement("script");
        s.src = "https://sdk.mercadopago.com/js/v2";
        s.async = true;
        s.onload = ok;
        s.onerror = function () { cargaSdk = null; mal(new Error("No se pudo cargar el formulario de pago de Mercado Pago")); };
        document.head.appendChild(s);
      });
    }
    return cargaSdk;
  }

  function desmontar() {
    if (controlador) {
      try { controlador.unmount(); } catch (ignorado) { /* ya desmontado */ }
      controlador = null;
    }
  }

  function irAlPago(p) {
    var email = document.getElementById("adminEmail").value;
    raiz.querySelector("[data-pago-plan]").textContent = "Plan " + p.nombre + " · 1 mes";
    raiz.querySelector("[data-pago-quien]").textContent = nombre.value + " · " + email;
    raiz.querySelector("[data-pago-monto]").textContent = p.precio.toFixed(2);
    error(errorPago, "");
    mostrar("pago");
    if (!habilitado || !clavePublica) {
      error(errorPago, "Los pagos con tarjeta no están configurados en el servidor. Elige el plan gratuito o vuelve más tarde.");
      return;
    }
    desmontar();
    cargarSdk().then(function () {
      var mp = new window.MercadoPago(clavePublica, { locale: "es-PE" });
      return mp.bricks().create("cardPayment", "mp-brick", {
        initialization: { amount: p.precio, payer: { email: email } },
        customization: { paymentMethods: { maxInstallments: 1 } },
        callbacks: {
          onReady: function () {},
          onError: function (e) { error(errorPago, (e && e.message) || "Error en el formulario de pago"); },
          onSubmit: function (tarjeta) { error(errorPago, ""); return enviar(tarjeta); }
        }
      });
    }).then(function (c) { controlador = c; }).catch(function (e) { error(errorPago, e.message); });
  }

  nombre.addEventListener("input", function () {
    if (!slugEditado) slug.value = aSlug(nombre.value);
  });
  slug.addEventListener("input", function () {
    slugEditado = true;
    var limpio = aSlug(slug.value);
    if (slug.value !== limpio && !/-$/.test(slug.value)) slug.value = limpio;
  });
  form.addEventListener("change", function (e) {
    if (e.target.name === "plan") actualizarPlan();
  });
  raiz.querySelector("[data-volver]").addEventListener("click", function () {
    desmontar();
    mostrar("datos");
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    error(errorDatos, "");
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    var p = plan();
    if (!p) return;
    if (p.precio === 0) {
      botonEnviar.disabled = true;
      botonEnviar.textContent = "Creando…";
      enviar(null).catch(function () { /* el error ya se muestra */ }).then(function () {
        botonEnviar.disabled = false;
        actualizarPlan();
      });
    } else {
      irAlPago(p);
    }
  });

  actualizarPlan();
})();
