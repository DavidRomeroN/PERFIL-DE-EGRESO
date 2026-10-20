"use client";

import { useCallback, useRef } from "react";

/** Timbre de llamado generado con Web Audio (sin archivos externos) y voz opcional. */
export function useSonido() {
  const ctxRef = useRef<AudioContext | null>(null);

  const timbre = useCallback(() => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current ??= new Ctx();
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const notas = [880, 1174.66, 1567.98];
      notas.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        const t0 = ctx.currentTime + i * 0.18;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
        o.connect(g).connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + 0.55);
      });
    } catch {
      /* sin audio */
    }
  }, []);

  const hablar = useCallback((texto: string) => {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = "es-PE";
      u.rate = 0.95;
      const voces = window.speechSynthesis.getVoices();
      const voz = voces.find((v) => v.lang.startsWith("es-PE")) ?? voces.find((v) => v.lang.startsWith("es"));
      if (voz) u.voice = voz;
      window.speechSynthesis.speak(u);
    } catch {
      /* sin voz */
    }
  }, []);

  const vibrar = useCallback(() => {
    try {
      navigator.vibrate?.([200, 100, 200, 100, 400]);
    } catch {
      /* sin vibración */
    }
  }, []);

  return { timbre, hablar, vibrar };
}
