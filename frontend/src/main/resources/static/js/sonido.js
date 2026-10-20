/*
 * Timbre (Web Audio, sin archivos), voz (Web Speech API) y vibración. Lo usan la TV, el panel y "mi turno".
 * Los navegadores solo permiten sonar después de una interacción del usuario: por eso cada pantalla tiene un
 * botón para activar el sonido.
 */
(function () {
  "use strict";
  var contexto = null;

  function timbre() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      contexto = contexto || new Ctx();
      if (contexto.state === "suspended") contexto.resume();
      [880, 1174.66, 1567.98].forEach(function (frecuencia, i) {
        var o = contexto.createOscillator();
        var g = contexto.createGain();
        o.type = "sine";
        o.frequency.value = frecuencia;
        var t0 = contexto.currentTime + i * 0.18;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
        o.connect(g).connect(contexto.destination);
        o.start(t0);
        o.stop(t0 + 0.55);
      });
    } catch (ignorado) { /* sin audio */ }
  }

  function hablar(texto) {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(texto);
      u.lang = "es-PE";
      u.rate = 0.95;
      var voces = window.speechSynthesis.getVoices();
      var voz = voces.find(function (v) { return v.lang.indexOf("es-PE") === 0; }) ||
        voces.find(function (v) { return v.lang.indexOf("es") === 0; });
      if (voz) u.voice = voz;
      window.speechSynthesis.speak(u);
    } catch (ignorado) { /* sin voz */ }
  }

  function vibrar() {
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
    } catch (ignorado) { /* sin vibración */ }
  }

  /** "A-012" → "A 0 1 2" para que la voz lo lea dígito por dígito. */
  function deletrear(codigo) {
    return String(codigo).replace("-", " ").split("").join(" ");
  }

  /** Botón que activa/desactiva el sonido y recuerda la elección en el dispositivo. */
  function interruptor(boton, clave) {
    if (!boton) return function () { return false; };
    var activo = false;
    try { activo = localStorage.getItem(clave) === "1"; } catch (ignorado) { /* sin almacenamiento */ }
    function pintar() {
      boton.setAttribute("aria-pressed", String(activo));
      var texto = boton.querySelector("[data-texto-sonido]");
      if (texto) texto.textContent = activo ? "Sonido activado" : "Activar sonido";
    }
    boton.addEventListener("click", function () {
      activo = !activo;
      try { localStorage.setItem(clave, activo ? "1" : "0"); } catch (ignorado) { /* sin almacenamiento */ }
      if (activo) timbre();
      pintar();
    });
    pintar();
    return function () { return activo; };
  }

  window.Sonido = { timbre: timbre, hablar: hablar, vibrar: vibrar, deletrear: deletrear, interruptor: interruptor };
})();
