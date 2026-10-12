"use client";

import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtDuracion, fmtHora } from "@/lib/format";

interface Props {
  codigo: string;
  cola: string;
  local: string;
  direccion: string | null;
  emitidoAt: string;
  personasDelante: number;
  tiempoEstimadoSeg: number;
  urlSeguimiento: string;
  nombre: string | null;
}

export function Ticket(p: Props) {
  useEffect(() => {
    const id = setTimeout(() => window.print(), 600);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-100 p-6 print:bg-white print:p-0">
      <div className="no-print mb-4 flex w-[300px] gap-2">
        <Button className="flex-1" onClick={() => window.print()}><Printer className="size-4" /> Imprimir</Button>
        <Button variant="outline" onClick={() => window.close()}><X className="size-4" /> Cerrar</Button>
      </div>

      {/* Ticket térmico 80 mm */}
      <style>{`@media print { @page { size: 80mm auto; margin: 4mm; } }`}</style>
      <article className="w-[80mm] bg-white p-5 font-mono text-[13px] leading-snug text-black shadow-md print:shadow-none" style={{ fontFamily: "ui-monospace, 'Courier New', monospace" }}>
        <header className="text-center">
          <p className="text-lg font-bold uppercase tracking-wide">{p.local}</p>
          {p.direccion && <p className="text-[11px]">{p.direccion}</p>}
          <p className="mt-1 text-[11px]">{fmtHora(p.emitidoAt)} · {new Date(p.emitidoAt).toLocaleDateString("es-PE")}</p>
        </header>

        <div className="my-4 border-t border-dashed border-black" />

        <section className="text-center">
          <p className="text-[11px] uppercase tracking-widest">Su turno</p>
          <p className="my-1 text-6xl font-bold leading-none tracking-tight">{p.codigo}</p>
          <p className="text-sm font-semibold uppercase">{p.cola}</p>
          {p.nombre && <p className="mt-1 text-[12px]">{p.nombre}</p>}
        </section>

        <div className="my-4 border-t border-dashed border-black" />

        <section className="grid grid-cols-2 text-center text-[12px]">
          <div>
            <p className="text-[10px] uppercase">Delante de Ud.</p>
            <p className="text-xl font-bold">{p.personasDelante}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase">Espera aprox.</p>
            <p className="text-xl font-bold">{fmtDuracion(p.tiempoEstimadoSeg)}</p>
          </div>
        </section>

        <div className="my-4 border-t border-dashed border-black" />

        <section className="flex flex-col items-center text-center">
          <QRCodeSVG value={p.urlSeguimiento} size={120} level="M" />
          <p className="mt-2 text-[11px]">Escanee para seguir su turno desde el celular y recibir el aviso.</p>
          <p className="mt-1 break-all text-[9px] text-zinc-600">{p.urlSeguimiento.replace(/^https?:\/\//, "")}</p>
        </section>

        <div className="my-4 border-t border-dashed border-black" />

        <footer className="text-center text-[10px] text-zinc-600">
          <p>Esté atento a la pantalla. Si no se presenta en 3 minutos tras el llamado, perderá su turno.</p>
          <p className="mt-2 font-bold text-black">TurnoYa · fila virtual</p>
        </footer>
      </article>
    </div>
  );
}
