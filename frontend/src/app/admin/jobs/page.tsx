"use client";

import { Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { Estado, Tabla, accion, fmtFechaHora, useDatos } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

interface Job {
  nombre: string;
  descripcion: string;
  frecuencia: string;
  ultimaCorrida: string | null;
  ultimaDuracionMs: number | null;
  ultimoResultado: unknown;
  ultimoError: string | null;
  corridas: number;
  fallos: number;
  proxima: string | null;
  enCurso: boolean;
}

/** F1 · Estado de los jobs programados (solo super-admin): última corrida, resultado, próxima y ejecución manual. */
export default function Page() {
  const { datos, error, cargando, recargar } = useDatos<Job[]>("/api/v1/jobs");
  return (
    <div className="space-y-6">
      <PageHeader title="Jobs programados" description="Cada job se reclama en la base de datos: aunque haya varias instancias, corre una sola vez.">
        <Button variant="outline" onClick={() => void recargar()}>Actualizar</Button>
      </PageHeader>
      <Estado cargando={cargando} error={error}>
        <Tabla
          columnas={["Job", "Frecuencia", "Última corrida", "Duración", "Resultado", "Próxima", ""]}
          filas={(datos ?? []).map((j) => [
            <span key="n"><b className="font-mono text-xs">{j.nombre}</b><span className="block text-xs text-muted-foreground">{j.descripcion}</span></span>,
            j.frecuencia,
            fmtFechaHora(j.ultimaCorrida),
            j.ultimaDuracionMs != null ? `${j.ultimaDuracionMs} ms` : "—",
            j.ultimoError ? (
              <Badge key="e" className="bg-rose-100 text-rose-800" title={j.ultimoError}>Error</Badge>
            ) : (
              <span key="r" className="text-xs text-muted-foreground">{j.ultimoResultado ? JSON.stringify(j.ultimoResultado).slice(0, 60) : "—"}{j.fallos ? ` · ${j.fallos} fallos` : ""}</span>
            ),
            fmtFechaHora(j.proxima),
            <Button key="x" size="xs" variant="outline" disabled={j.enCurso} onClick={async () => { if (await accion(() => api(`/api/v1/jobs/${j.nombre}`, { method: "POST" }), `${j.nombre} ejecutado`)) void recargar(); }}><Play className="size-3" /> Ejecutar</Button>,
          ])}
        />
      </Estado>
    </div>
  );
}
