"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { BellRing, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const SALIDAS = ["El ticket", "El aviso", "La pantalla", "El reporte"] as const;
type Salida = (typeof SALIDAS)[number];

/** Semana de ejemplo: las cifras cuadran (390 + 13 + 9 = 412 · abandono 22/412 = 5,3 %). */
const SEMANA = [
  { d: "Lun", n: 71 },
  { d: "Mar", n: 64 },
  { d: "Mié", n: 58 },
  { d: "Jue", n: 66 },
  { d: "Vie", n: 79 },
  { d: "Sáb", n: 52 },
  { d: "Dom", n: 22 },
];

function Hoja({ salida, local, url }: { salida: Salida; local: string; url: string }) {
  if (salida === "El ticket")
    return (
      <div data-ui className="w-[300px] bg-white px-6 pb-10 pt-7 text-center font-mono text-slate-900 shadow-2xl">
        <p className="text-sm font-bold uppercase">{local}</p>
        <p className="text-[13px] text-slate-500">Jr. San Román 452, Juliaca</p>
        <div className="my-4 border-t border-dashed border-slate-300" />
        <p className="text-[13px] uppercase tracking-[0.3em] text-slate-500">Turno</p>
        <p className="text-6xl font-bold tracking-tight">A-018</p>
        <p className="mt-1 text-[13px]">Medicina General</p>
        <p className="text-[13px] text-slate-500">13/10/2026 · 10:31</p>
        <div className="my-4 border-t border-dashed border-slate-300" />
        <div className="mx-auto w-fit">
          <QRCodeSVG value={url} size={120} level="M" />
        </div>
        <p className="mt-3 text-[13px]">Escanea para seguir tu turno</p>
        <p className="mt-1 text-[13px] text-slate-500">Delante de ti: 3 personas</p>
      </div>
    );
  if (salida === "El aviso")
    return (
      <div data-ui className="w-[440px] overflow-hidden rounded-2xl bg-[#ece5dd] shadow-2xl">
        <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
          <span className="flex size-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">P</span>
          <div>
            <p className="text-sm font-semibold">{local}</p>
            <p className="text-[12px] text-white/70">cuenta de empresa</p>
          </div>
        </div>
        <div className="space-y-2 p-4 pb-16">
          <p className="mx-auto w-fit rounded-lg bg-white/80 px-2 py-0.5 text-[12px] text-slate-600">HOY</p>
          <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm text-slate-900 shadow-sm">
            Hola María 👋, tu turno <b>A-018</b> en <b>{local}</b> está por llegar: faltan 2 personas. Acércate a la sala.
            <span className="mt-1 block text-right text-[11px] text-slate-500">10:42</span>
          </div>
          <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm text-slate-900 shadow-sm">
            📢 Es tu turno <b>A-018</b>. Acércate a <b>Consultorio 2</b>.
            <span className="mt-1 block text-right text-[11px] text-slate-500">10:51</span>
          </div>
          <div className="ml-auto max-w-[60%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm text-emerald-950 shadow-sm">
            Gracias, ya voy
            <span className="mt-1 flex items-center justify-end gap-1 text-[11px] text-emerald-800/70">
              10:51 <CheckCheck className="size-3 text-sky-600" />
            </span>
          </div>
        </div>
      </div>
    );
  if (salida === "La pantalla")
    return (
      <div data-ui className="w-[560px] overflow-hidden rounded-2xl bg-slate-950 text-white shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <p className="font-semibold">{local}</p>
          <p className="text-xl font-semibold tabular-nums">10:51</p>
        </div>
        <div className="grid grid-cols-[1.3fr_1fr] gap-3 p-4">
          <div className="rounded-xl bg-[radial-gradient(ellipse_at_top,rgba(13,148,136,0.55),transparent_70%)] p-5 text-center ring-1 ring-white/10">
            <p className="flex items-center justify-center gap-1.5 text-[12px] uppercase tracking-[0.25em] text-white/60">
              <BellRing className="size-3.5" /> Llamando a
            </p>
            <p className="mt-2 font-mono text-6xl font-bold">A-018</p>
            <p className="mx-auto mt-3 w-fit rounded-lg bg-teal-600 px-4 py-1 text-lg font-semibold">Consultorio 2</p>
          </div>
          <div className="space-y-2 rounded-xl bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/50">En atención</p>
            {[
              ["B-009", "Laboratorio"],
              ["A-017", "Consultorio 1"],
              ["C-004", "Caja 1"],
            ].map(([c, v]) => (
              <p key={c} className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-1.5">
                <span className="font-mono font-bold">{c}</span>
                <span className="text-[13px]">{v}</span>
              </p>
            ))}
          </div>
        </div>
        <p className="bg-teal-900/70 px-5 py-2 text-[13px] text-white/80">Bienvenido. Toma tu turno con el QR y espera donde quieras.</p>
      </div>
    );
  const max = Math.max(...SEMANA.map((s) => s.n));
  return (
    <div data-ui className="w-[560px] bg-white p-8 text-slate-900 shadow-2xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xl font-semibold tracking-tight">Reporte de espera</p>
          <p className="text-[13px] text-slate-500">{local} · 6 al 12 de octubre de 2026</p>
        </div>
        <span className="rounded-md bg-teal-50 px-2 py-1 text-[12px] font-semibold text-teal-800">PDF</span>
      </div>
      <div className="mt-6 grid grid-cols-4 gap-3 text-[13px]">
        {[
          ["Turnos", "412"],
          ["Atendidos", "390"],
          ["Espera prom.", "9,8 min"],
          ["Abandono", "5,3 %"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-50 p-3">
            <p className="text-slate-500">{k}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-[13px] font-medium text-slate-600">Turnos por día</p>
      <div className="mt-2 flex h-36 items-end gap-3">
        {SEMANA.map((s, i) => (
          <div key={s.d} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[11px] tabular-nums text-slate-500">{s.n}</span>
            <div className="w-full origin-bottom animate-[crece_600ms_var(--ease-out)_backwards] rounded-t-md bg-teal-600" style={{ height: `${(s.n / max) * 100}%`, animationDelay: `${i * 50}ms` }} />
            <span className="text-[11px] text-slate-500">{s.d}</span>
          </div>
        ))}
      </div>
      <p className="mt-6 text-[12px] text-slate-500">No se presentaron: 13 · Cancelados: 9 · Hora pico: 10:00–11:00</p>
    </div>
  );
}

/** Índice de lo que el sistema produce: elegir un nombre muestra la pieza real a tamaño natural. */
export function IndiceSalidas({ local, url }: { local: string; url: string }) {
  const [sel, setSel] = useState<Salida>("El ticket");
  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <div className="flex snap-x gap-5 overflow-x-auto pb-2 lg:col-span-5 lg:flex-col lg:gap-1 lg:overflow-visible" role="tablist" aria-label="Lo que produce TurnoYa">
        {SALIDAS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={sel === s}
            onClick={() => setSel(s)}
            className={cn("shrink-0 snap-start text-left text-[22px] font-semibold tracking-tight transition-colors duration-200 lg:text-[clamp(36px,4vw,60px)] lg:leading-[1.1]", sel === s ? "text-foreground" : "text-muted-foreground/45 hover:text-muted-foreground")}
          >
            {s}
          </button>
        ))}
        <p className="mt-6 hidden max-w-sm text-[17px] text-muted-foreground lg:block">
          Cuatro piezas, una sola fila: lo que ve el cliente en la mano, en el celular y en la sala, y lo que ve el dueño a fin de semana.
        </p>
      </div>
      <div className="relative h-[70svh] overflow-hidden rounded-3xl bg-teal-50 lg:col-span-7 lg:h-[640px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={sel}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            className="absolute left-4 top-10 origin-top-left max-sm:scale-[0.82] sm:left-16 sm:top-[72px]"
          >
            <Hoja salida={sel} local={local} url={url} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
