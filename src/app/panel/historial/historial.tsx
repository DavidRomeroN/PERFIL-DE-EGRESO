"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Estado, Kpi, Tabla, descargarCsv, fmtHora, useDatos } from "@/components/app/modulo-ui";
import { ESTADO_LABEL } from "@/lib/format";

interface Respuesta {
  items: { id: number; codigo: string; codigoProvisional: string | null; estado: string; canal: string; emitidoAt: string; llamadoAt: string | null; finalizadoAt: string | null; rellamadas: number; cola: { nombre: string }; ventanilla: { nombre: string } | null; cliente: { nombre: string | null } | null }[];
  kpis: { total: number; atendidos: number; noPresentados: number; atencionPromMin: number; esperaPromMin: number };
}

/** N02 · Historial del operador: turnos del día con filtros y KPIs. */
export function Historial() {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  const [fecha, setFecha] = useState(hoy);
  const [estado, setEstado] = useState("");
  const [ventanilla, setVentanilla] = useState<string | null>(null);
  useEffect(() => setVentanilla(localStorage.getItem("turnoya:ventanilla-id")), []);
  const url = `/api/v1/turnos?fecha=${fecha}${estado ? `&estado=${estado}` : ""}${ventanilla ? `&ventanillaId=${ventanilla}` : ""}`;
  const { datos, error, cargando } = useDatos<Respuesta>(url, [url]);

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon-sm"><Link href="/panel" aria-label="Volver al panel"><ArrowLeft className="size-4" /></Link></Button>
          <h1 className="text-2xl font-bold">Historial del día</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input type="date" aria-label="Fecha" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} className="w-40" />
          <NativeSelect aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)} className="w-44">
            <option value="">Todos los estados</option>
            {["EMITIDO", "AVISADO", "LLAMADO", "ATENDIDO", "NO_SE_PRESENTO", "CANCELADO", "TRANSFERIDO"].map((e) => <option key={e} value={e}>{ESTADO_LABEL[e as keyof typeof ESTADO_LABEL] ?? e}</option>)}
          </NativeSelect>
          <Button variant="outline" disabled={!datos?.items.length} onClick={() => descargarCsv(`historial-${fecha}.csv`, [["codigo", "cola", "estado", "canal", "emitido", "llamado", "finalizado", "ventanilla"], ...(datos?.items ?? []).map((t) => [t.codigo, t.cola.nombre, t.estado, t.canal, fmtHora(t.emitidoAt), fmtHora(t.llamadoAt), fmtHora(t.finalizadoAt), t.ventanilla?.nombre ?? ""])])}>Exportar CSV</Button>
        </div>
      </div>
      <Estado cargando={cargando} error={error}>
        {datos && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Kpi etiqueta="Turnos" valor={datos.kpis.total} />
              <Kpi etiqueta="Atendidos" valor={datos.kpis.atendidos} tono="bien" />
              <Kpi etiqueta="No se presentaron" valor={datos.kpis.noPresentados} tono={datos.kpis.noPresentados ? "alerta" : "default"} />
              <Kpi etiqueta="Espera prom." valor={`${datos.kpis.esperaPromMin} min`} />
              <Kpi etiqueta="Atención prom." valor={`${datos.kpis.atencionPromMin} min`} />
            </div>
            <Tabla
              columnas={["Turno", "Cola", "Estado", "Emitido", "Llamado", "Fin", "Ventanilla", "Cliente"]}
              filas={datos.items.map((t) => [
                <span key="c" className="font-mono font-semibold">{t.codigo}{t.codigoProvisional ? ` (${t.codigoProvisional})` : ""}</span>,
                t.cola.nombre,
                ESTADO_LABEL[t.estado as keyof typeof ESTADO_LABEL] ?? t.estado,
                fmtHora(t.emitidoAt),
                fmtHora(t.llamadoAt),
                fmtHora(t.finalizadoAt),
                t.ventanilla?.nombre ?? "—",
                t.cliente?.nombre ?? "—",
              ])}
              vacio="No hay turnos con esos filtros."
            />
          </>
        )}
      </Estado>
    </main>
  );
}
