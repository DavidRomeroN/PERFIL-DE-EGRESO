"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BellRing, CheckCheck, Clock, MessageCircle, Users } from "lucide-react";
import { Numero } from "@/components/app/motion";
import { cn } from "@/lib/utils";

const EASE = [0.23, 1, 0.32, 1] as const;

/** Guion de la demo: la fila avanza, llega el WhatsApp y al final llaman al turno. */
const PASOS = [
  { delante: 3, min: 14, estado: "En espera", progreso: 0.3, aviso: false },
  { delante: 2, min: 9, estado: "Avisado", progreso: 0.52, aviso: true },
  { delante: 1, min: 4, estado: "Avisado", progreso: 0.76, aviso: true },
  { delante: 0, min: 0, estado: "Llamado", progreso: 1, aviso: true },
] as const;

/** Fragmento real de la página de seguimiento (/t/…) que se mueve solo en el hero de la landing. */
export function TicketVivo({ local }: { local: string }) {
  const reducir = useReducedMotion();
  const [i, setI] = useState(1);
  useEffect(() => {
    if (reducir) return;
    const t = setInterval(() => setI((x) => (x + 1) % PASOS.length), 2600);
    return () => clearInterval(t);
  }, [reducir]);
  const p = PASOS[reducir ? 1 : i];
  const llamado = p.delante === 0;

  return (
    <div data-ui className="relative h-full w-full overflow-hidden rounded-t-[2rem] bg-card ring-1 ring-foreground/10" aria-label="Ejemplo de la página de seguimiento de un turno">
      <div className="bg-teal-700 px-5 pb-8 pt-5 text-white">
        <p className="text-[13px] text-white/70">Tu turno en</p>
        <p className="font-semibold">{local}</p>
      </div>
      <div className="-mt-4 rounded-t-3xl bg-card px-5 pt-5 text-center">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Medicina General</span>
          <span key={p.estado} className={cn("animate-pop rounded-md px-2 py-0.5 font-medium", llamado ? "bg-teal-100 text-teal-800" : p.aviso ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700")}>
            {p.estado}
          </span>
        </div>
        <p className={cn("mt-4 font-mono text-6xl font-bold tracking-tight text-teal-700 transition-transform duration-500 ease-out", llamado && "scale-105")}>A-018</p>

        <div className="relative mt-5 h-28">
          <AnimatePresence mode="popLayout" initial={false}>
            {llamado ? (
              <motion.div key="llamado" initial={{ opacity: 0, y: 14, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: EASE }} className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-teal-700 text-white">
                <p className="flex items-center gap-1.5 text-[13px] font-medium uppercase tracking-[0.14em]">
                  <BellRing className="size-4 origin-top animate-campana" /> Es tu turno
                </p>
                <p className="mt-1 text-2xl font-bold">Consultorio 2</p>
              </motion.div>
            ) : (
              <motion.div key="espera" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, filter: "blur(4px)" }} transition={{ duration: 0.35, ease: EASE }} className="absolute inset-0 grid grid-cols-2 gap-2.5">
                <div className="flex flex-col items-center justify-center rounded-2xl bg-muted/70">
                  <p className="flex items-center gap-1 text-[13px] text-muted-foreground"><Users className="size-3.5" /> Delante</p>
                  <p className="text-4xl font-semibold"><Numero valor={p.delante} /></p>
                </div>
                <div className="flex flex-col items-center justify-center rounded-2xl bg-muted/70">
                  <p className="flex items-center gap-1 text-[13px] text-muted-foreground"><Clock className="size-3.5" /> Minutos</p>
                  <p className="text-4xl font-semibold"><Numero valor={p.min} /></p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full origin-left rounded-full bg-teal-600 transition-transform duration-700 ease-out" style={{ transform: `scaleX(${p.progreso})` }} />
        </div>

        <div className="mt-5 min-h-24 rounded-2xl bg-[#ece5dd] p-2.5 text-left">
          <AnimatePresence initial={false}>
            {p.aviso && (
              <motion.div key="burbuja" initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.35, ease: EASE }} style={{ transformOrigin: "bottom right" }} className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[13px] text-emerald-950 shadow-sm">
                <p className="flex items-start gap-1.5">
                  <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                  <span>Hola María, tu turno <b>A-018</b> está por llegar: faltan 2 personas.</span>
                </p>
                <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-emerald-800/70">
                  10:42 <CheckCheck className="size-3 text-sky-600" />
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
