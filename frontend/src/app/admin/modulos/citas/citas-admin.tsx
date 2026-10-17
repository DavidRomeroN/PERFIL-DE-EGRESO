"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/app/page-header";
import { Estado, Pestanas, Seccion, Tabla, accion, fmtFechaHora, useDatos } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

interface Agenda {
  slots: { id: number; colaId: number; cola: string; hora: string; capacidad: number; reservados: number }[];
  citas: { id: number; token: string; hora: string; estado: string; canal: string; cola: { nombre: string }; nombre: string | null; telefono: string | null; codigoCheckin: string; turno: { codigo: string; estado: string } | null }[];
}
type Config = Record<string, number | boolean | null | number[]> & { activo: boolean };
interface Bloqueos {
  agenda: { id: number; inicio: string; fin: string; motivo: string; cola: { nombre: string } | null }[];
  clientes: { id: number; nombre: string | null; hasta: string; motivo: string }[];
}

const CAMPOS: [string, string][] = [
  ["duracionSlotMin", "Duración del horario (min)"],
  ["cuotaCitasPct", "Cuota para citas (% de ventanillas)"],
  ["anticipacionMinMin", "Anticipación mínima (min)"],
  ["anticipacionMaxDias", "Anticipación máxima (días)"],
  ["checkinAntesMin", "Check-in desde (min antes)"],
  ["checkinDespuesMin", "Check-in hasta (min después)"],
  ["graciaNoShowMin", "Gracia para llegar tarde (min)"],
  ["maxNoShow", "Inasistencias para bloquear"],
  ["bloqueoDias", "Días de bloqueo"],
  ["pesoCita", "Peso de prioridad de la cita"],
];

/** M3 · Agenda del día, configuración por servicio y bloqueos (feriados y clientes). */
export function CitasAdmin({ colas, slug, plan }: { colas: { id: number; nombre: string }[]; slug: string; plan: string }) {
  const [tab, setTab] = useState<"agenda" | "config" | "bloqueos">("agenda");
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  const [fecha, setFecha] = useState(hoy);
  const agenda = useDatos<Agenda>(`/api/v1/citas?fecha=${fecha}`, [fecha]);
  const configs = useDatos<{ cola: { id: number; nombre: string }; config: Config }[]>("/api/v1/citas/config");
  const bloqueos = useDatos<Bloqueos>("/api/v1/citas/bloqueos");
  const [edit, setEdit] = useState<Record<number, Config>>({});
  const [bloq, setBloq] = useState({ colaId: "", inicio: `${hoy}T08:00`, fin: `${hoy}T18:00`, motivo: "Feriado" });

  useEffect(() => {
    if (configs.datos) setEdit(Object.fromEntries(configs.datos.map((c) => [c.cola.id, c.config])));
  }, [configs.datos]);

  async function accionCita(id: number, a: string) {
    if (await accion(() => api(`/api/v1/citas/${id}`, { method: "PATCH", json: { accion: a } }), "Listo")) void agenda.recargar();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Citas y reservas" description="Reservas sin sobrecupo, check-in con PIN de presencia y recordatorios automáticos.">
        <Button asChild variant="outline"><Link href={`/l/${slug}/citas`} target="_blank">Página de reservas <ExternalLink className="size-3.5" /></Link></Button>
      </PageHeader>
      <Pestanas valor={tab} onCambio={setTab} opciones={[{ valor: "agenda", etiqueta: "Agenda" }, { valor: "config", etiqueta: "Configuración" }, { valor: "bloqueos", etiqueta: "Bloqueos", contador: bloqueos.datos?.clientes.length }]} />

      {tab === "agenda" && (
        <Seccion titulo="Agenda del día" acciones={<Input type="date" aria-label="Fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-40" />}>
          <Estado cargando={agenda.cargando} error={agenda.error}>
            {agenda.datos && (
              <div className="space-y-5">
                {agenda.datos.slots.length > 0 && (
                  <div className="flex flex-wrap gap-2" aria-label="Ocupación por horario">
                    {agenda.datos.slots.map((s) => (
                      <div key={s.id} className="w-24 rounded-lg border p-2 text-xs" title={s.cola}>
                        <p className="font-semibold">{s.hora}</p>
                        <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-teal-600" style={{ width: `${(s.reservados / Math.max(1, s.capacidad)) * 100}%` }} /></div>
                        <p className="mt-0.5 text-muted-foreground">{s.reservados}/{s.capacidad}</p>
                      </div>
                    ))}
                  </div>
                )}
                <Tabla
                  columnas={["Hora", "Servicio", "Cliente", "Estado", "Código", "Turno", "Acciones"]}
                  vacio="No hay citas este día."
                  filas={agenda.datos.citas.map((c) => [
                    <b key="h">{c.hora}</b>,
                    c.cola.nombre,
                    <span key="n">{c.nombre ?? "—"}<span className="block text-xs text-muted-foreground">{c.telefono ?? ""} · {c.canal}</span></span>,
                    c.estado,
                    <span key="c" className="font-mono">{c.codigoCheckin}</span>,
                    c.turno ? `${c.turno.codigo} (${c.turno.estado})` : "—",
                    ["RESERVADA", "CONFIRMADA"].includes(c.estado) ? (
                      <div key="a" className="flex flex-wrap gap-1">
                        <Button size="xs" variant="outline" onClick={() => accionCita(c.id, "ASISTIO")}>Asistió</Button>
                        <Button size="xs" variant="outline" onClick={() => accionCita(c.id, "NO_SHOW")}>No vino</Button>
                        <Button size="xs" variant="ghost" className="text-rose-700" onClick={() => accionCita(c.id, "CANCELAR")}>Cancelar</Button>
                      </div>
                    ) : null,
                  ])}
                />
              </div>
            )}
          </Estado>
        </Seccion>
      )}

      {tab === "config" && (
        <Estado cargando={configs.cargando} error={configs.error}>
          <div className="space-y-4">
            {plan === "EMPRENDE" && <p className="text-sm text-muted-foreground">El plan Emprende permite citas en 1 servicio.</p>}
            {colas.map((c) => {
              const cfg = edit[c.id];
              if (!cfg) return null;
              return (
                <Seccion
                  key={c.id}
                  titulo={c.nombre}
                  acciones={
                    <>
                      <label className="flex items-center gap-2 text-sm">Atiende con cita <Switch checked={!!cfg.activo} onCheckedChange={(v) => setEdit({ ...edit, [c.id]: { ...cfg, activo: v } })} /></label>
                      <Button size="sm" onClick={async () => {
                        const { colaId: _c, recordatoriosMin: _r, capacidadFija, ...resto } = cfg as Record<string, unknown>;
                        void _c; void _r;
                        if (await accion(() => api("/api/v1/citas/config", { method: "PUT", json: { colaId: c.id, ...resto, capacidadFija: capacidadFija || null } }), "Configuración guardada")) void configs.recargar();
                      }}>Guardar</Button>
                    </>
                  }
                >
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {CAMPOS.map(([k, l]) => (
                      <div key={k}>
                        <Label htmlFor={`${c.id}-${k}`} className="text-xs">{l}</Label>
                        <Input id={`${c.id}-${k}`} type="number" value={Number(cfg[k] ?? 0)} onChange={(e) => setEdit({ ...edit, [c.id]: { ...cfg, [k]: Number(e.target.value) } })} />
                      </div>
                    ))}
                    <div>
                      <Label htmlFor={`${c.id}-cap`} className="text-xs">Capacidad fija (vacío = por cuota)</Label>
                      <Input id={`${c.id}-cap`} type="number" value={cfg.capacidadFija == null ? "" : Number(cfg.capacidadFija)} onChange={(e) => setEdit({ ...edit, [c.id]: { ...cfg, capacidadFija: e.target.value ? Number(e.target.value) : null } })} />
                    </div>
                  </div>
                </Seccion>
              );
            })}
          </div>
        </Estado>
      )}

      {tab === "bloqueos" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Seccion titulo="Bloquear agenda" descripcion="Feriados u horas sin atención: no se ofrecen horarios en ese rango.">
            <form className="grid gap-3" onSubmit={async (e) => {
              e.preventDefault();
              const json = { colaId: bloq.colaId ? Number(bloq.colaId) : null, inicio: new Date(`${bloq.inicio}:00-05:00`).toISOString(), fin: new Date(`${bloq.fin}:00-05:00`).toISOString(), motivo: bloq.motivo };
              if (await accion(() => api("/api/v1/citas/bloqueos", { method: "POST", json }), "Bloqueo creado")) void bloqueos.recargar();
            }}>
              <NativeSelect aria-label="Servicio" value={bloq.colaId} onChange={(e) => setBloq({ ...bloq, colaId: e.target.value })}>
                <option value="">Todo el local</option>
                {colas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </NativeSelect>
              <div className="grid grid-cols-2 gap-2">
                <Input type="datetime-local" aria-label="Desde" value={bloq.inicio} onChange={(e) => setBloq({ ...bloq, inicio: e.target.value })} />
                <Input type="datetime-local" aria-label="Hasta" value={bloq.fin} onChange={(e) => setBloq({ ...bloq, fin: e.target.value })} />
              </div>
              <Input aria-label="Motivo" value={bloq.motivo} onChange={(e) => setBloq({ ...bloq, motivo: e.target.value })} />
              <Button type="submit">Bloquear</Button>
            </form>
            <ul className="mt-4 divide-y text-sm">
              {bloqueos.datos?.agenda.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2">
                  <span>{fmtFechaHora(b.inicio)} → {fmtFechaHora(b.fin)} · {b.motivo} · {b.cola?.nombre ?? "Todo el local"}</span>
                  <Button size="xs" variant="ghost" onClick={async () => { if (await accion(() => api(`/api/v1/citas/bloqueos/${b.id}`, { method: "DELETE" }), "Eliminado")) void bloqueos.recargar(); }}>Quitar</Button>
                </li>
              ))}
            </ul>
          </Seccion>
          <Seccion titulo="Clientes bloqueados" descripcion="Por inasistencias repetidas (RN-M3-06).">
            <Tabla
              columnas={["Cliente", "Hasta", "Motivo", ""]}
              vacio="Nadie bloqueado."
              filas={(bloqueos.datos?.clientes ?? []).map((b) => [
                b.nombre ?? "Cliente",
                fmtFechaHora(b.hasta),
                b.motivo,
                <Button key="l" size="xs" variant="outline" onClick={async () => { if (await accion(() => api(`/api/v1/citas/bloqueos-cliente/${b.id}`, { method: "DELETE" }), "Cliente liberado")) void bloqueos.recargar(); }}>Liberar</Button>,
              ])}
            />
          </Seccion>
        </div>
      )}
    </div>
  );
}
