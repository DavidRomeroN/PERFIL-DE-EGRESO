/*
 * M5 · App del kiosco offline-first.
 *  - Emparejamiento con el código de 6 dígitos del admin: el token queda en el almacenamiento local del navegador.
 *  - Cada "Imprimir" se guarda primero en la cola local con su clave de idempotencia (UUID v7) y luego se intenta la red;
 *    si falla, el ticket es provisional (K{n}-{seq}) y se sincroniza en lotes con reintentos (backoff + jitter).
 *  - Latido cada 20 s: estima el desfase de reloj (muestra de menor RTT entre las últimas 5) y recarga la configuración.
 *  - Vuelve al inicio tras 30 s sin tocar la pantalla; 5 toques en el nombre del local abren el menú de mantenimiento.
 */
(function () {
  "use strict";

  var VERSION_APP = "kiosco-java-1.0";
  var K = { token: "turnoya:kiosco:token", config: "turnoya:kiosco:config", cola: "turnoya:kiosco:cola", qrs: "turnoya:kiosco:qrs" };
  var raiz = document.getElementById("kiosco");
  if (!raiz) return;

  // --- Almacenamiento local (puede fallar en modo privado: la app sigue en memoria) ---
  var memoria = {};
  function leer(clave) {
    try { var v = localStorage.getItem(clave); return v == null ? memoria[clave] || null : JSON.parse(v); } catch (e) { return memoria[clave] || null; }
  }
  function escribir(clave, valor) {
    memoria[clave] = valor;
    try { if (valor == null) localStorage.removeItem(clave); else localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* solo memoria */ }
  }

  var estado = {
    token: leer(K.token),
    config: leer(K.config),
    cola: null,
    categoria: null,
    conexion: "ONLINE",
    fallos: 0,
    desdeFallo: 0,
    muestras: [],
    offset: 0,
    ultimoTicket: null,
    actividad: Date.now(),
    toques: 0,
    sincronizando: false
  };

  // --- Utilidades ---
  function $(sel, base) { return (base || document).querySelector(sel); }
  function $$(sel, base) { return Array.prototype.slice.call((base || document).querySelectorAll(sel)); }
  function hoyLocal() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date()); }
  function uuidv7(ms) {
    var b = new Uint8Array(10);
    crypto.getRandomValues(b);
    var hex = ms.toString(16).padStart(12, "0");
    var r = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    var variante = ((parseInt(r.charAt(3), 16) & 0x3) | 0x8).toString(16);
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-7" + r.slice(0, 3) + "-" + variante + r.slice(4, 7) + "-" + r.slice(7, 19);
  }
  function backoff(intentos) { return Math.min(60000, Math.pow(2, Math.max(0, intentos)) * 1000) + Math.floor(Math.random() * 1000); }
  function codigoProvisional(numero, seq) { return "K" + numero + "-" + String(seq).padStart(4, "0"); }
  function urlProvisional(fecha, seq) { return location.origin + "/k/" + estado.config.dispositivo.id + "/" + fecha + "/" + seq; }

  function llamar(url, cuerpo, timeoutMs) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 4000);
    return fetch(url, {
      method: cuerpo === undefined ? "GET" : "POST",
      headers: { "Authorization": "Bearer " + estado.token, "Content-Type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: ctrl.signal,
      cache: "no-store"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (res.status === 401) { revocado(); throw Object.assign(new Error("Dispositivo no autorizado"), { codigo: "M5_DISPOSITIVO_NO_AUTORIZADO" }); }
        if (!res.ok || !b.ok) throw Object.assign(new Error((b.error && b.error.mensaje) || ("HTTP " + res.status)), { codigo: b.error && b.error.codigo, red: res.status >= 500 });
        return b.data;
      });
    }).finally(function () { clearTimeout(t); });
  }

  // --- Pantallas ---
  function mostrar(vista) {
    raiz.setAttribute("data-pantalla", vista);
    $$("[data-vista]").forEach(function (s) { s.hidden = s.getAttribute("data-vista") !== vista; });
    $$("[data-error]").forEach(function (e) { e.textContent = ""; });
    var emparejado = vista !== "emparejar";
    $("[data-cabecera]").hidden = !emparejado;
    pintarConexion();
    if (vista === "mantenimiento") { $("[data-menu-mantenimiento]").hidden = true; $("#k-pin").value = ""; }
    if (vista === "cita") { var c = $("#k-codigo-cita"); c.value = ""; c.focus(); }
  }
  function error(msg) { var v = $("[data-vista]:not([hidden]) [data-error]"); if (v) v.textContent = msg; }

  function pintarConfig() {
    var c = estado.config;
    if (!c) return;
    document.body.style.setProperty("--local", c.local.color || "#0f766e");
    $("[data-accion=toque-local]").textContent = c.local.nombre;
    var cerrado = $("[data-cerrado]");
    cerrado.hidden = c.abierto;
    cerrado.textContent = c.mensajeCerrado || "El local está cerrado ahora.";
    $("[data-solo-citas]").hidden = !c.citas;
    var lista = $("[data-lista-colas]");
    lista.textContent = "";
    c.colas.forEach(function (cola) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "kiosco-opcion kiosco-opcion-alta";
      b.setAttribute("data-cola", cola.id);
      b.textContent = cola.nombre;
      if (cola.descripcion) { var s = document.createElement("span"); s.textContent = cola.descripcion; b.appendChild(s); }
      lista.appendChild(b);
    });
    var cats = $("[data-lista-categorias]");
    cats.textContent = "";
    [{ codigo: "", nombre: "General" }].concat(c.categorias).forEach(function (cat) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "kiosco-opcion";
      b.setAttribute("data-categoria", cat.codigo);
      b.textContent = cat.nombre;
      cats.appendChild(b);
    });
  }

  function pendientes() { return leer(K.cola) || []; }
  function guardarPendientes(xs) { escribir(K.cola, xs); }

  function pintarConexion() {
    var n = pendientes().length;
    var e = estado.conexion;
    raiz.setAttribute("data-conexion", e);
    $("[data-texto-conexion]").textContent = (e === "ONLINE" ? "En línea" : e === "OFFLINE" ? "Sin conexión" : e === "SINCRONIZANDO" ? "Sincronizando" : "Conexión inestable") + (n ? " · " + n + " pendientes" : "");
    $("[data-aviso-offline]").hidden = e !== "OFFLINE" || raiz.getAttribute("data-pantalla") === "emparejar";
  }

  // --- Conexión (§6.1) ---
  function ok(rtt) {
    estado.fallos = 0;
    estado.conexion = pendientes().length ? "SINCRONIZANDO" : rtt < 2000 ? "ONLINE" : "DEGRADADO";
    pintarConexion();
  }
  function fallo() {
    if (!estado.fallos) estado.desdeFallo = Date.now();
    estado.fallos++;
    estado.conexion = estado.fallos >= 3 || Date.now() - estado.desdeFallo >= 60000 ? "OFFLINE" : estado.conexion === "OFFLINE" ? "OFFLINE" : "DEGRADADO";
    pintarConexion();
  }

  // --- Emparejamiento ---
  function revocado() {
    estado.token = null;
    escribir(K.token, null);
    $("[data-titulo-emparejar]").textContent = "Dispositivo no autorizado";
    mostrar("emparejar");
  }

  function emparejar() {
    var codigo = $("#k-codigo-par").value.replace(/\D/g, "");
    if (codigo.length !== 6) { error("El código tiene 6 dígitos"); return; }
    fetch("/api/v1/kiosco/emparejar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo: codigo }) })
      .then(function (r) { return r.json(); })
      .then(function (b) {
        if (!b.ok) throw new Error((b.error && b.error.mensaje) || "Código inválido");
        estado.token = b.data.token;
        estado.config = b.data.config;
        escribir(K.token, estado.token);
        escribir(K.config, estado.config);
        escribir(K.qrs, null);
        pintarConfig();
        mostrar("inicio");
        latido();
      })
      .catch(function (e) { error(e.message || "No se pudo emparejar"); });
  }

  // --- Latido cada 20 s ---
  function latido() {
    if (!estado.token) return;
    var t0 = Date.now();
    llamar("/api/v1/kiosco/heartbeat", { estado: estado.conexion, pendientes: pendientes().length, version: VERSION_APP, offsetMs: estado.offset })
      .then(function (r) {
        var t1 = Date.now();
        var rtt = t1 - t0;
        estado.muestras = estado.muestras.concat([{ rtt: rtt, offset: Math.round(Date.parse(r.serverTime) - (t0 + rtt / 2)) }]).slice(-5);
        estado.offset = estado.muestras.reduce(function (a, b) { return b.rtt < a.rtt ? b : a; }).offset;
        ok(rtt);
        if (!estado.config || r.configVersion !== estado.config.version) {
          return llamar("/api/v1/kiosco/config").then(function (c) { estado.config = c; escribir(K.config, c); pintarConfig(); });
        }
      })
      .then(function () { precargarQrs(); if (pendientes().length) sincronizar(); })
      .catch(function (e) { if (e.codigo !== "M5_DISPOSITIVO_NO_AUTORIZADO") fallo(); });
  }

  // --- QR: sin red no se pueden generar; se precargan los de los próximos tickets provisionales ---
  function siguienteSeq(fecha) { var s = leer("turnoya:kiosco:seq:" + fecha) || 0; return s + 1; }
  function precargarQrs() {
    if (!estado.config) return;
    var fecha = hoyLocal();
    var desde = siguienteSeq(fecha);
    var q = leer(K.qrs);
    if (q && q.fecha === fecha && q.dispositivo === estado.config.dispositivo.id && q.desde <= desde && q.desde + q.svgs.length - 5 > desde) return;
    var textos = [];
    for (var i = 0; i < 20; i++) textos.push(urlProvisional(fecha, desde + i));
    llamar("/api/v1/kiosco/qr", { textos: textos }, 8000)
      .then(function (svgs) { escribir(K.qrs, { fecha: fecha, dispositivo: estado.config.dispositivo.id, desde: desde, svgs: svgs }); })
      .catch(function () { /* se reintenta en el próximo latido */ });
  }
  function qrProvisional(fecha, seq) {
    var q = leer(K.qrs);
    if (!q || q.fecha !== fecha || seq < q.desde || seq >= q.desde + q.svgs.length) return null;
    return q.svgs[seq - q.desde];
  }

  // --- Emisión (§6.2): clave → cola local → red; si falla, ticket provisional con la MISMA clave ---
  function imprimir() {
    var c = estado.config;
    var cola = estado.cola;
    if (!c || !cola) return;
    var fecha = hoyLocal();
    var seq = siguienteSeq(fecha);
    escribir("turnoya:kiosco:seq:" + fecha, seq);
    var ahora = Date.now();
    var ev = {
      claveIdem: uuidv7(ahora),
      seq: seq,
      tipo: "EMITIR_TURNO",
      tsDispositivo: new Date(ahora).toISOString(),
      offsetMsAlEmitir: estado.offset,
      payload: { colaId: cola.id, categoria: estado.categoria || null },
      intentos: 0,
      proximoIntentoAt: ahora,
      fecha: fecha
    };
    guardarPendientes(pendientes().concat([ev]));
    var provisional = function () {
      fallo();
      ticket({ codigo: codigoProvisional(c.dispositivo.numero, seq), provisional: true, cola: cola.nombre, qr: qrProvisional(fecha, seq) });
    };
    if (estado.conexion === "OFFLINE") { provisional(); return; }
    llamar("/api/v1/kiosco/turnos", { claveIdem: ev.claveIdem, seq: seq, tsDispositivo: ev.tsDispositivo, offsetMsAlEmitir: ev.offsetMsAlEmitir, colaId: cola.id, categoria: ev.payload.categoria })
      .then(function (r) {
        quitar([ev.claveIdem]);
        if (r.turno) {
          var url = location.origin + "/t/" + r.turno.token;
          return llamar("/api/v1/kiosco/qr", { textos: [url] }).then(function (svgs) { return svgs[0]; }, function () { return null; }).then(function (svg) {
            ticket({ codigo: r.turno.codigo, provisional: false, cola: cola.nombre, qr: svg });
          });
        }
        ticket({ codigo: codigoProvisional(c.dispositivo.numero, seq), provisional: true, cola: cola.nombre, qr: qrProvisional(fecha, seq) });
      })
      .catch(function (e) { if (e.codigo !== "M5_DISPOSITIVO_NO_AUTORIZADO") provisional(); });
  }

  function quitar(claves) { guardarPendientes(pendientes().filter(function (e) { return claves.indexOf(e.claveIdem) < 0; })); pintarConexion(); }

  function ticket(t) {
    estado.ultimoTicket = t;
    $("[data-ticket-cola]").textContent = t.cola;
    $("[data-ticket-codigo]").textContent = t.codigo;
    $("[data-ticket-provisional]").hidden = !t.provisional;
    var qr = $("[data-ticket-qr]");
    qr.innerHTML = t.qr || "";
    $("[data-ticket-qr-texto]").hidden = !t.qr;
    mostrar("ticket");
    setTimeout(function () { window.print(); }, 300);
  }

  // --- Sincronización por lotes ---
  function sincronizar() {
    if (!estado.token || estado.sincronizando) return;
    var todos = pendientes();
    var lote = todos.filter(function (e) { return e.proximoIntentoAt <= Date.now(); }).slice(0, 100);
    if (!lote.length) return;
    estado.sincronizando = true;
    var eventos = lote.map(function (e) { return { claveIdem: e.claveIdem, seq: e.seq, tipo: e.tipo, tsDispositivo: e.tsDispositivo, offsetMsAlEmitir: e.offsetMsAlEmitir, payload: e.payload }; });
    llamar("/api/v1/kiosco/sync", { eventos: eventos }, 15000)
      .then(function (r) { quitar(r.resultados.map(function (x) { return x.claveIdem; })); ok(0); })
      .catch(function () {
        var claves = lote.map(function (e) { return e.claveIdem; });
        guardarPendientes(pendientes().map(function (e) {
          return claves.indexOf(e.claveIdem) < 0 ? e : Object.assign({}, e, { intentos: e.intentos + 1, proximoIntentoAt: Date.now() + backoff(e.intentos + 1) });
        }));
      })
      .finally(function () { estado.sincronizando = false; pintarConexion(); });
  }

  // --- Cita ---
  function checkin() {
    var codigo = $("#k-codigo-cita").value.trim().toUpperCase();
    if (codigo.length < 6) { error("El código tiene al menos 6 caracteres"); return; }
    llamar("/api/v1/kiosco/citas/checkin", { codigo: codigo })
      .then(function (r) {
        var url = location.origin + "/t/" + r.turnoToken;
        return llamar("/api/v1/kiosco/qr", { textos: [url] }).then(function (s) { return s[0]; }, function () { return null; }).then(function (svg) {
          ticket({ codigo: r.codigo, provisional: false, cola: "Cita", qr: svg });
        });
      })
      .catch(function (e) { error(e.message || "No se pudo hacer el check-in"); });
  }

  // --- Mantenimiento ---
  function validarPin() {
    var pin = $("#k-pin").value.replace(/\D/g, "");
    llamar("/api/v1/kiosco/mantenimiento", { pin: pin })
      .then(function (r) {
        if (!r.valido) { error("PIN incorrecto"); return; }
        $("[data-menu-mantenimiento]").hidden = false;
        $("[data-diagnostico]").textContent = "Pendientes: " + pendientes().length + " · desfase " + Math.round(estado.offset / 1000) + " s · " + VERSION_APP;
      })
      .catch(function (e) { error(e.message || "No se pudo validar"); });
  }

  // --- Eventos de la interfaz ---
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var accion = b.getAttribute("data-accion");
    if (b.hasAttribute("data-cola")) {
      var id = Number(b.getAttribute("data-cola"));
      estado.cola = estado.config.colas.filter(function (c) { return c.id === id; })[0];
      estado.categoria = null;
      if (estado.config.categorias.length) mostrar("tipo"); else imprimir();
      return;
    }
    if (b.hasAttribute("data-categoria")) { estado.categoria = b.getAttribute("data-categoria") || null; imprimir(); return; }
    switch (accion) {
      case "emparejar": emparejar(); break;
      case "inicio": mostrar("inicio"); break;
      case "servicio": mostrar("servicio"); break;
      case "cita": mostrar("cita"); break;
      case "checkin": checkin(); break;
      case "validar-pin": validarPin(); break;
      case "sincronizar": sincronizar(); break;
      case "reimprimir": if (estado.ultimoTicket) window.print(); break;
      case "desemparejar": escribir(K.token, null); estado.token = null; $("[data-titulo-emparejar]").textContent = "Emparejar kiosco"; mostrar("emparejar"); break;
      case "toque-local":
        estado.toques++;
        if (estado.toques >= 5) { estado.toques = 0; mostrar("mantenimiento"); }
        break;
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    if (e.target.id === "k-codigo-par") emparejar();
    if (e.target.id === "k-codigo-cita") checkin();
    if (e.target.id === "k-pin") validarPin();
  });
  document.addEventListener("pointerdown", function () { estado.actividad = Date.now(); });
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  // Inactividad: vuelve al inicio a los 30 s (RF-M5-09)
  setInterval(function () {
    var p = raiz.getAttribute("data-pantalla");
    var limite = ((estado.config && estado.config.inactividadSeg) || 30) * 1000;
    if (p !== "inicio" && p !== "mantenimiento" && p !== "emparejar" && Date.now() - estado.actividad > limite) mostrar("inicio");
  }, 1000);

  window.addEventListener("online", latido);
  setInterval(latido, 20000);
  setInterval(sincronizar, 10000);

  // Service worker con alcance /kiosco: la página abre aunque no haya red
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/kiosco-sw.js", { scope: "/kiosco" }).catch(function () { /* sin SW */ });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  // Arranque
  if (estado.token && estado.config) { pintarConfig(); mostrar("inicio"); latido(); }
  else if (estado.token) { mostrar("inicio"); latido(); }
  else mostrar("emparejar");
})();
