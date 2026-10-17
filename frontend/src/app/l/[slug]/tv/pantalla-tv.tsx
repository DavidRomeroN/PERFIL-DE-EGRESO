"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, Maximize2, Volume2, VolumeX } from "lucide-react";
import { EnVivo, Numero } from "@/components/app/motion";
import { api } from "@/lib/fetcher";
import { fmtDuracion, fmtHora } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SnapshotLocal } from "@backend/turnos";
import { useRealtime } from "@/hooks/use-realtime";
import { useSonido } from "@/hooks/use-sonido";

type Snap = SnapshotLocal;

interface Llamado {
  id: number;
  codigo: string;
  ventanilla: string;
  cola: string;
  at: number;
  rellamada: boolean;
}

const EASE = [0.23, 1, 0.32, 1] as const;

export function PantallaTv({ inicial, claveTv }: { inicial: Snap; claveTv?: string | null }) {
  // M3: PIN de presencia rotativo (solo con el enlace firmado de la pantalla)
  const [pin, setPin] = useState<{ pin: string; segundosRestantes: number } | null>(null);
  useEffect(() => {
    if (!claveTv) return;
    const cargar = () => fetch(`/api/v1/public/locales/${inicial.local.slug}/pin-presencia?k=${encodeURIComponent(claveTv)}`).then((r) => r.json()).then((b) => setPin(b?.data ?? null)).catch(() => {});
    void cargar();
    const t = setInterval(cargar, 30_000);
    return () => clearInterval(t);
  }, [claveTv, inicial.local.slug]);
  const [snap, setSnap] = useState<Snap>(inicial);
  const [ultimo, setUltimo] = useState<Llamado | null>(() => {
    const l = inicial.ultimosLlamados[0];
    return l ? { id: l.id, codigo: l.codigo, ventanilla: l.ventanilla, cola: "", at: Date.now() - 60_000, rellamada: false } : null;
  });
  const [sonido, setSonido] = useState(false);
  const [hora, setHora] = useState("");
  const [flash, setFlash] = useState(false);
  const { timbre, hablar } = useSonido();
  const sonidoRef = useRef(sonido);
  useEffect(() => {
    sonidoRef.current = sonido;
  }, [sonido]);
  const [urlQr, setUrlQr] = useState("");

  const refrescar = useCallback(async () => {
    try {
      setSnap(await api<Snap>(`/api/v1/public/locales/${inicial.local.slug}/estado`));
    } catch {
      /* ignorar */
    }
  }, [inicial.local.slug]);

  const conexion = useRealtime(inicial.local.slug, (e) => {
    if (e.tipo === "turno:llamado") {
      setUltimo({ id: e.turno.id, codigo: e.turno.codigo, ventanilla: e.turno.ventanilla, cola: e.turno.cola, at: Date.now(), rellamada: e.turno.rellamada });
      setFlash(true);
      setTimeout(() => setFlash(false), 4000);
      if (sonidoRef.current) {
        timbre();
        setTimeout(() => hablar(`Turno ${e.turno.codigo.replace("-", " ").split("").join(" ")}, ${e.turno.ventanilla}`), 700);
      }
      void refrescar();
    } else if (e.tipo === "cola:actualizada" || e.tipo === "turno:estado") {
      void refrescar();
    }
  });

  useEffect(() => {
    setUrlQr(`${window.location.origin}/l/${inicial.local.slug}`);
    const tick = () => setHora(new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }).format(new Date()));
    tick();
    const id = setInterval(tick, 10_000);
    const poll = setInterval(refrescar, 20_000);
    return () => {
      clearInterval(id);
      clearInterval(poll);
    };
  }, [inicial.local.slug, refrescar]);

  const color = snap.local.colorPrimario;
  const llamadosActivos = snap.colas.flatMap((c) => c.llamados.map((l) => ({ ...l, cola: c.nombre, prefijo: c.prefijo })));
  const recientes = snap.ultimosLlamados.filter((l) => l.id !== ultimo?.id).slice(0, 6);

  function pantallaCompleta() {
    const el = document.documentElement;
    if (!document.fullscreenElement) void el.requestFullscreen?.();
    else void document.exitFullscreen?.();
  }

  return (
    <div className="relative flex h-dvh w-screen flex-col overflow-hidden bg-slate-950 text-white" style={{ ["--local" as string]: color }}>
      {/* Luz ambiental: se desplaza muy lento para que la pantalla no se vea congelada */}
      <div className="pointer-events-none absolute -left-1/4 -top-1/3 size-[70vmax] animate-drift rounded-full opacity-40 blur-3xl" style={{ background: `radial-gradient(circle, color-mix(in oklch, ${color} 60%, transparent), transparent 65%)` }} aria-hidden />
      <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay" aria-hidden />

      {/* Barra superior */}
      <header className="relative flex items-center justify-between border-b border-white/10 px-8 py-4">
        <div className="flex items-center gap-4">
          {snap.local.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={snap.local.logoUrl} alt="" className="size-14 rounded-xl bg-white object-contain p-1" />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-xl text-2xl font-bold shadow-lg" style={{ background: color }}>
              {snap.local.nombreComercial.slice(0, 1)}
            </span>
          )}
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{snap.local.nombreComercial}</h1>
            <p className="text-sm text-white/60">{snap.local.direccion}</p>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <span className="text-5xl font-semibold tabular-nums tracking-tight">{hora}</span>
          <div className="no-print flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSonido((s) => !s);
                if (!sonido) timbre();
              }}
              className={cn("press rounded-xl border border-white/15 p-2.5 hover:bg-white/10", sonido && "bg-white/15")}
              title={sonido ? "Silenciar" : "Activar sonido y voz"}
              aria-pressed={sonido}
            >
              {sonido ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
            </button>
            <button type="button" onClick={pantallaCompleta} className="press rounded-xl border border-white/15 p-2.5 hover:bg-white/10" title="Pantalla completa">
              <Maximize2 className="size-5" />
            </button>
            <EnVivo estado={conexion} oscuro etiqueta={false} className="rounded-xl border border-white/15 p-3.5" />
          </div>
        </div>
      </header>

      {/* Cuerpo */}
      <main className="relative grid flex-1 grid-cols-[1.35fr_1fr] gap-6 overflow-hidden p-6">
        {/* Columna izquierda: llamado principal + colas */}
        <section className="flex flex-col gap-6 overflow-hidden">
          <div
            className={cn("relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-3xl border border-white/10 p-8 text-center transition-[border-color,box-shadow] duration-500", flash && "animate-flash-call border-white/30")}
            style={{
              background: `radial-gradient(ellipse at top, color-mix(in oklch, ${color} 55%, transparent), transparent 70%), rgb(15 23 42)`,
              boxShadow: flash ? `0 0 0 1px color-mix(in oklch, ${color} 60%, transparent), 0 0 120px -20px ${color}` : undefined,
            }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {ultimo ? (
                <motion.div
                  key={`${ultimo.id}-${ultimo.at}`}
                  className="flex flex-col items-center"
                  initial={{ opacity: 0, y: 60, scale: 0.92, filter: "blur(12px)" }}
                  animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -50, scale: 0.96, filter: "blur(10px)", transition: { duration: 0.35, ease: EASE } }}
                  transition={{ duration: 0.7, ease: EASE }}
                >
                  <p className="flex items-center gap-2 text-xl font-medium uppercase tracking-[0.25em] text-white/70">
                    <BellRing className={cn("size-6 origin-top", flash && "animate-campana")} /> {ultimo.rellamada ? "Rellamando" : "Llamando a"}
                  </p>
                  <p className="mt-4 font-mono text-[9rem] font-bold leading-none tracking-tight drop-shadow-[0_8px_30px_rgba(0,0,0,0.6)] xl:text-[12rem]">{ultimo.codigo}</p>
                  <motion.div
                    className="mt-6 rounded-2xl px-10 py-4 text-4xl font-semibold shadow-xl ring-1 ring-white/20 xl:text-5xl"
                    style={{ background: color }}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.18, ease: EASE }}
                  >
                    {ultimo.ventanilla}
                  </motion.div>
                  {ultimo.cola && <p className="mt-4 text-lg text-white/60">{ultimo.cola}</p>}
                </motion.div>
              ) : (
                <motion.div key="vacio" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <BellRing className="mx-auto size-12 animate-float text-white/30" />
                  <p className="mt-4 text-2xl text-white/60">Esperando el primer llamado…</p>
                  <p className="mt-3 text-white/40">Los turnos aparecerán aquí en tiempo real</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Resumen por cola */}
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, snap.colas.length))}, minmax(0, 1fr))` }}>
            {snap.colas.map((c) => (
              <div key={c.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg font-mono text-lg font-bold" style={{ background: color }}>{c.prefijo}</span>
                  <p className="truncate text-lg font-medium">{c.nombre}</p>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-4xl font-bold"><Numero valor={c.enEspera} /></p>
                    <p className="text-xs uppercase tracking-wider text-white/50">en espera</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-semibold">{c.enEspera ? `~ ${fmtDuracion(c.tiempoEstimadoSeg)}` : "Sin espera"}</p>
                    <p className="text-xs uppercase tracking-wider text-white/50">próximo</p>
                  </div>
                </div>
                {c.espera.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {c.espera.slice(0, 5).map((t) => (
                        <motion.span
                          key={t.id}
                          layout
                          initial={{ opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.85 }}
                          transition={{ duration: 0.3, ease: EASE }}
                          className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-sm"
                        >
                          {t.codigo}
                        </motion.span>
                      ))}
                    </AnimatePresence>
                    {c.espera.length > 5 && <span className="rounded-md px-2 py-0.5 text-sm text-white/50">+{c.espera.length - 5}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Columna derecha: en atención + últimos + QR */}
        <section className="flex flex-col gap-6 overflow-hidden">
          <div className="flex-1 overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/60">En atención</p>
            <div className="mt-4 space-y-3">
              {llamadosActivos.length === 0 && <p className="text-white/40">Ninguna ventanilla está atendiendo.</p>}
              <AnimatePresence mode="popLayout" initial={false}>
                {llamadosActivos.slice(0, 5).map((l) => (
                  <motion.div
                    key={l.id}
                    layout
                    initial={{ opacity: 0, x: 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -30, transition: { duration: 0.25, ease: EASE } }}
                    transition={{ duration: 0.45, ease: EASE }}
                    className={cn("flex items-center justify-between rounded-2xl bg-white/10 px-5 py-3 ring-1 transition-[box-shadow] duration-700", l.id === ultimo?.id && flash ? "ring-white/40" : "ring-transparent")}
                  >
                    <span className="font-mono text-4xl font-bold">{l.codigo}</span>
                    <span className="text-right">
                      <span className="block text-xl font-semibold">{l.ventanilla}</span>
                      <span className="block text-xs text-white/50">{l.cola} · {fmtHora(l.llamadoAt)}</span>
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {recientes.length > 0 && (
              <>
                <p className="mt-8 text-sm font-medium uppercase tracking-[0.2em] text-white/60">Últimos llamados</p>
                <ul className="mt-3">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {recientes.map((l) => (
                      <motion.li
                        key={l.id}
                        layout
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, ease: EASE }}
                        className="flex items-center justify-between border-b border-white/10 py-2 text-white/80 last:border-b-0"
                      >
                        <span className="font-mono text-2xl font-semibold">{l.codigo}</span>
                        <span className="text-sm">{l.ventanilla}</span>
                        <span className="text-xs tabular-nums text-white/50">{fmtHora(l.llamadoAt)}</span>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </>
            )}
          </div>

          <div className="flex items-center gap-5 rounded-3xl border border-white/10 bg-white p-5 text-slate-900 shadow-2xl">
            <div className="shrink-0 rounded-xl bg-white p-1">
              {urlQr && <QRCodeSVG value={urlQr} size={128} level="M" fgColor="#0f172a" />}
            </div>
            <div>
              <p className="text-2xl font-bold leading-tight">Toma tu turno con el QR</p>
              <p className="mt-1 text-slate-600">Escanéalo con tu celular, elige el servicio y espera donde quieras. Te avisamos por WhatsApp.</p>
              <p className="mt-2 font-mono text-xs text-slate-500">{urlQr.replace(/^https?:\/\//, "")}</p>
            </div>
          </div>
        </section>
      </main>

      {/* Cinta inferior */}
      <footer className="relative overflow-hidden border-t border-white/10 py-3" style={{ background: `color-mix(in oklch, ${color} 35%, rgb(2 6 23))` }}>
        <div className="animate-marquee whitespace-nowrap text-xl text-white/90">
          {pin && <b>PIN para check-in de citas: {pin.pin} &nbsp;&nbsp;•&nbsp;&nbsp; </b>}{snap.local.mensajeTv ?? "Bienvenido. Por favor espere su llamado."} &nbsp;&nbsp;•&nbsp;&nbsp; Hoy: {snap.stats.atendidos} atendidos · {snap.stats.enEspera} en espera · espera promedio {snap.stats.esperaPromedioMin} min
          &nbsp;&nbsp;•&nbsp;&nbsp; Fila virtual por TurnoYa
        </div>
      </footer>
    </div>
  );
}
