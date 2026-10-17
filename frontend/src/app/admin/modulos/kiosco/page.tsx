"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/app/page-header";
import { Estado, Modal, Pestanas, Seccion, Tabla, accion, fmtFechaHora, useDatos } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

interface Disp { id: number; prefijo: string; nombre: string; activo: boolean; emparejado: boolean; enLinea: boolean; relojDesfasado: boolean; offsetRelojMs: number; pendientes: number; versionApp: string | null; ultimoHeartbeatAt: string | null; impresora: string | null }
interface Ev { id: string; dispositivo: string; seq: number; estado: string; motivo: string | null; tsDispositivo: string; recibidoAt: string }

/** M5 · Dispositivos (emparejar, revocar, rotar) y cola de sincronización con resolución de conflictos. */
export default function Page() {
  const [tab, setTab] = useState<"dispositivos" | "eventos">("dispositivos");
  const disps = useDatos<Disp[]>("/api/v1/kiosco/dispositivos");
  const [filtro, setFiltro] = useState("REVISION");
  const evs = useDatos<{ items: Ev[] }>(`/api/v1/kiosco/eventos?estado=${filtro}`, [filtro]);
  const [nuevo, setNuevo] = useState(false);
  const [nombre, setNombre] = useState("Entrada principal");
  const [codigo, setCodigo] = useState<{ codigo: string; expira: string; pin?: string } | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="Kiosco offline" description="Tótem táctil que sigue emitiendo tickets aunque se caiga internet y sincroniza sin duplicados al volver.">
        <Button onClick={() => setNuevo(true)}><Plus className="size-4" /> Nuevo kiosco</Button>
      </PageHeader>
      <Pestanas valor={tab} onCambio={setTab} opciones={[{ valor: "dispositivos", etiqueta: "Dispositivos" }, { valor: "eventos", etiqueta: "Cola de sincronización" }]} />

      {tab === "dispositivos" && (
        <Estado cargando={disps.cargando} error={disps.error} vacio={!disps.datos?.length} mensajeVacio="Aún no hay kioscos. Crea uno y empareja la tablet abriendo /kiosco.">
          <div className="grid gap-4 md:grid-cols-2">
            {disps.datos?.map((d) => (
              <Seccion key={d.id} titulo={`${d.prefijo} · ${d.nombre}`} acciones={
                <Badge className={!d.activo ? "bg-muted text-muted-foreground" : d.enLinea ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{!d.activo ? "Revocado" : !d.emparejado ? "Sin emparejar" : d.enLinea ? "● En línea" : "○ Sin conexión"}</Badge>
              }>
                <dl className="grid grid-cols-2 gap-1 text-sm">
                  <dt className="text-muted-foreground">Último latido</dt><dd>{fmtFechaHora(d.ultimoHeartbeatAt)}</dd>
                  <dt className="text-muted-foreground">Pendientes</dt><dd>{d.pendientes}</dd>
                  <dt className="text-muted-foreground">Reloj</dt><dd className={d.relojDesfasado ? "text-rose-700" : ""}>{d.relojDesfasado ? "⚠ " : ""}{Math.round(d.offsetRelojMs / 1000)} s</dd>
                  <dt className="text-muted-foreground">Versión</dt><dd>{d.versionApp ?? "—"}</dd>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={async () => { const r = await accion(() => api<{ codigo: string; expira: string }>(`/api/v1/kiosco/dispositivos/${d.id}/rotar`, { method: "POST" })); if (r) { setCodigo(r); void disps.recargar(); } }}>{d.emparejado ? "Rotar token" : "Nuevo código"}</Button>
                  {d.activo && <Button size="sm" variant="ghost" className="text-rose-700" onClick={async () => { if (await accion(() => api(`/api/v1/kiosco/dispositivos/${d.id}`, { method: "DELETE" }), "Kiosco revocado")) void disps.recargar(); }}>Revocar</Button>}
                </div>
              </Seccion>
            ))}
          </div>
        </Estado>
      )}

      {tab === "eventos" && (
        <Seccion titulo="Eventos sincronizados" acciones={
          <NativeSelect aria-label="Estado" value={filtro} onChange={(e) => setFiltro(e.target.value)} className="w-40">
            {["REVISION", "APLICADO", "DUPLICADO", "RECHAZADO"].map((e) => <option key={e} value={e}>{e}</option>)}
          </NativeSelect>
        }>
          <Estado cargando={evs.cargando} error={evs.error}>
            <Tabla
              columnas={["Kiosco", "N.°", "Emitido en el kiosco", "Recibido", "Estado", "Motivo", ""]}
              vacio="Sin eventos en este estado."
              filas={(evs.datos?.items ?? []).map((e) => [
                e.dispositivo, e.seq, fmtFechaHora(e.tsDispositivo), fmtFechaHora(e.recibidoAt), e.estado, e.motivo ?? "—",
                e.estado === "REVISION" ? (
                  <div key="a" className="flex gap-1">
                    <Button size="xs" onClick={async () => { if (await accion(() => api(`/api/v1/kiosco/eventos/${e.id}/resolver`, { method: "POST", json: { accion: "EMITIR_AHORA" } }), "Turno emitido")) void evs.recargar(); }}>Emitir ahora</Button>
                    <Button size="xs" variant="ghost" onClick={async () => { if (await accion(() => api(`/api/v1/kiosco/eventos/${e.id}/resolver`, { method: "POST", json: { accion: "DESCARTAR" } }), "Descartado")) void evs.recargar(); }}>Descartar</Button>
                  </div>
                ) : null,
              ])}
            />
          </Estado>
        </Seccion>
      )}

      <Modal abierto={nuevo} titulo="Nuevo kiosco" onCerrar={() => setNuevo(false)}>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const r = await accion(() => api<{ codigo: string; expira: string; pinMantenimiento: string }>("/api/v1/kiosco/dispositivos", { method: "POST", json: { nombre } }));
          if (r) { setNuevo(false); setCodigo({ codigo: r.codigo, expira: r.expira, pin: r.pinMantenimiento }); void disps.recargar(); }
        }}>
          <Input aria-label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Button type="submit" className="w-full">Crear y generar código</Button>
        </form>
      </Modal>
      <Modal abierto={!!codigo} titulo="Código de emparejamiento" onCerrar={() => setCodigo(null)}>
        <p className="text-center font-mono text-5xl font-bold tracking-widest">{codigo?.codigo}</p>
        <p className="mt-2 text-center text-sm text-muted-foreground">Ingrésalo en la tablet en <b>/kiosco</b>. Vence {fmtFechaHora(codigo?.expira)} y sirve una sola vez.</p>
        {codigo?.pin && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-center text-sm">PIN del menú de mantenimiento: <b className="font-mono">{codigo.pin}</b> (se muestra solo ahora)</p>}
      </Modal>
    </div>
  );
}
