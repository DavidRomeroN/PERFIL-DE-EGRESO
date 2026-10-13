"use client";

import { useState } from "react";
import { BellRing, CheckCheck, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

/** Fragmento de producto que acompaña a cada paso (interfaz real en HTML, no ilustraciones). */
function Fragmento({ paso }: { paso: number }) {
  if (paso === 0)
    return (
      <div data-ui className="w-56 rounded-2xl bg-white p-4 text-slate-900 shadow-xl">
        <p className="text-[13px] font-semibold">Policlínico San Román</p>
        <div className="mt-3 grid aspect-square place-items-center rounded-xl bg-slate-100">
          <QrCode className="size-24 text-slate-800" strokeWidth={1.2} />
        </div>
        <p className="mt-3 text-center text-[13px] text-slate-600">Escanea y elige tu servicio</p>
      </div>
    );
  if (paso === 1)
    return (
      <div data-ui className="w-60 rounded-2xl bg-white p-4 text-center text-slate-900 shadow-xl">
        <p className="text-[13px] text-slate-500">Laboratorio · En espera</p>
        <p className="mt-1 font-mono text-5xl font-bold text-teal-700">B-011</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
          <p className="rounded-xl bg-slate-100 py-2"><b className="block text-xl">3</b>delante</p>
          <p className="rounded-xl bg-slate-100 py-2"><b className="block text-xl">18</b>minutos</p>
        </div>
      </div>
    );
  if (paso === 2)
    return (
      <div data-ui className="w-64 rounded-2xl bg-[#ece5dd] p-3 shadow-xl">
        <div className="ml-auto rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[13px] text-emerald-950">
          Hola Lucía, tu turno <b>B-011</b> en <b>Policlínico San Román</b> está por llegar: faltan 2 personas.
          <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-emerald-800/70">
            11:06 <CheckCheck className="size-3 text-sky-600" />
          </span>
        </div>
      </div>
    );
  return (
    <div data-ui className="w-64 rounded-2xl bg-slate-950 p-5 text-center text-white shadow-xl ring-1 ring-white/10">
      <p className="flex items-center justify-center gap-1.5 text-[13px] uppercase tracking-[0.2em] text-white/60">
        <BellRing className="size-3.5" /> Llamando a
      </p>
      <p className="mt-2 font-mono text-5xl font-bold">B-011</p>
      <p className="mx-auto mt-3 w-fit rounded-xl bg-teal-600 px-4 py-1.5 text-lg font-semibold">Laboratorio</p>
    </div>
  );
}

const PASOS = [
  { nombre: "Escanea el QR", texto: "El cliente abre la web del local desde el QR de la sala, elige el servicio y toma su turno en tres toques. Sin instalar nada.", fondo: "bg-teal-950", tinta: "text-white" },
  { nombre: "Sigue su turno", texto: "Ve su posición y el tiempo estimado desde el celular, en vivo. Puede salir a hacer otra cosa mientras la fila avanza.", fondo: "bg-teal-800", tinta: "text-white" },
  { nombre: "Recibe el aviso", texto: "Cuando faltan dos personas le llega un WhatsApp automático con su número y el enlace para seguirlo.", fondo: "bg-teal-600", tinta: "text-white" },
  { nombre: "Lo llaman en la TV", texto: "La ventanilla pulsa «Llamar siguiente»: la TV muestra el número, suena el timbre y el celular vibra.", fondo: "bg-teal-200", tinta: "text-teal-950" },
];

/** "Así funciona" como acordeón horizontal: el paso abierto ocupa ~58 %, los demás quedan como franjas. */
export function PasosAcordeon() {
  const [abierto, setAbierto] = useState(0);
  return (
    <div className="flex flex-col overflow-hidden rounded-3xl lg:h-[520px] lg:flex-row">
      {PASOS.map((p, i) => {
        const activo = abierto === i;
        return (
          <div
            key={p.nombre}
            className={cn("relative min-w-0 overflow-hidden lg:basis-0 lg:transition-[flex-grow] lg:duration-500 lg:ease-in-out", p.fondo, p.tinta)}
            style={{ flexGrow: activo ? 4.2 : 1 }}
          >
            <button
              type="button"
              onClick={() => setAbierto(i)}
              aria-expanded={activo}
              className={cn("press flex h-16 w-full items-center px-5 text-left text-lg font-semibold lg:absolute lg:inset-0 lg:h-auto lg:items-end lg:p-6", activo && "lg:pointer-events-none")}
            >
              <span className={cn("transition-opacity duration-300 lg:origin-bottom-left lg:-rotate-90 lg:translate-x-7 lg:whitespace-nowrap lg:text-xl", activo && "lg:opacity-0")}>{p.nombre}</span>
            </button>
            {activo && (
              <div key={i} className="grid animate-[enter_450ms_var(--ease-out)_150ms_backwards] gap-6 px-5 pb-6 lg:absolute lg:inset-0 lg:grid-cols-2 lg:p-10">
                <div className="flex flex-col justify-between gap-4">
                  <h3 className="hidden text-4xl font-semibold tracking-tight lg:block">{p.nombre}</h3>
                  <p className="max-w-[36ch] text-[17px] leading-relaxed opacity-85">{p.texto}</p>
                </div>
                <div className="hidden items-center justify-center lg:flex">
                  <div className="animate-float">
                    <Fragmento paso={i} />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
