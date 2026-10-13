"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { Estado, Modal, Seccion, Tabla, fmtFechaHora, useDatos } from "@/components/app/modulo-ui";

interface Fila {
  id: number;
  createdAt: string;
  accion: string;
  entidad: string;
  entidadId: string | null;
  accionHumana: string | null;
  ip: string | null;
  requestId: string | null;
  datosJson: unknown;
  usuario: { nombre: string; email: string } | null;
}

/** N01 · Auditoría: filtros por rango, acción, entidad, texto y request_id; detalle del cambio y exportación CSV. */
export default function Page() {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  const [f, setF] = useState({ desde: "", hasta: hoy, accion: "", entidad: "", texto: "", requestId: "" });
  const [cursor, setCursor] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<Fila | null>(null);
  const qs = new URLSearchParams(Object.entries({ ...f, ...(cursor ? { cursor: String(cursor) } : {}) }).filter(([, v]) => v)).toString();
  const { datos, error, cargando } = useDatos<{ items: Fila[]; cursor: number | null }>(`/api/v1/auditoria?${qs}`, [qs]);
  const cambiar = (k: keyof typeof f, v: string) => {
    setCursor(null);
    setF({ ...f, [k]: v });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Auditoría" description="Quién hizo qué y cuándo: cada cambio queda con usuario, IP y request_id.">
        <Button asChild variant="outline"><a href={`/api/v1/auditoria?${qs}&formato=csv`}><Download className="size-4" /> Exportar CSV</a></Button>
      </PageHeader>
      <Seccion titulo="Filtros">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Input type="date" aria-label="Desde" value={f.desde} onChange={(e) => cambiar("desde", e.target.value)} />
          <Input type="date" aria-label="Hasta" value={f.hasta} max={hoy} onChange={(e) => cambiar("hasta", e.target.value)} />
          <Input aria-label="Acción" placeholder="Acción (UPDATE, TRANSFERIR…)" value={f.accion} onChange={(e) => cambiar("accion", e.target.value)} />
          <Input aria-label="Entidad" placeholder="Entidad (turno, cola…)" value={f.entidad} onChange={(e) => cambiar("entidad", e.target.value)} />
          <Input aria-label="Texto" placeholder="Buscar en la descripción" value={f.texto} onChange={(e) => cambiar("texto", e.target.value)} />
          <Input aria-label="Request ID" placeholder="request_id" value={f.requestId} onChange={(e) => cambiar("requestId", e.target.value)} />
        </div>
      </Seccion>
      <Estado cargando={cargando} error={error}>
        <Tabla
          columnas={["Fecha", "Usuario", "Acción", "Entidad", "Descripción", ""]}
          vacio="No hay eventos con esos filtros."
          filas={(datos?.items ?? []).map((a) => [
            fmtFechaHora(a.createdAt),
            a.usuario?.nombre ?? "sistema",
            a.accion,
            `${a.entidad}${a.entidadId ? ` #${a.entidadId}` : ""}`,
            a.accionHumana ?? "—",
            a.datosJson ? <Button key="d" size="xs" variant="ghost" onClick={() => setDetalle(a)}>Ver cambio</Button> : null,
          ])}
        />
        <div className="mt-3 flex justify-end gap-2">
          {cursor && <Button variant="outline" size="sm" onClick={() => setCursor(null)}>Inicio</Button>}
          {datos?.cursor && <Button variant="outline" size="sm" onClick={() => setCursor(datos.cursor)}>Más antiguos</Button>}
        </div>
      </Estado>
      <Modal abierto={!!detalle} titulo={`${detalle?.accion ?? ""} · ${detalle?.entidad ?? ""}`} onCerrar={() => setDetalle(null)}>
        <p className="text-xs text-muted-foreground">{fmtFechaHora(detalle?.createdAt)} · {detalle?.usuario?.email ?? "sistema"} · IP {detalle?.ip ?? "—"} · {detalle?.requestId ?? "sin request_id"}</p>
        <pre className="mt-3 max-h-[50vh] overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(detalle?.datosJson, null, 2)}</pre>
      </Modal>
    </div>
  );
}
