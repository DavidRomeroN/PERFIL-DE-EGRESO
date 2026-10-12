"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/app/page-header";
import { Estado, Kpi, Modal, Pestanas, Seccion, Tabla, accion, descargarCsv, fmtFechaHora, useDatos } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

type Pct = { grupo: string; n: number; espera: { p50: number | null; p90: number | null; p95: number | null }; atencion: { p50: number | null; p90: number | null } };
type Sla = { colaId: number; cola: string; configurado: boolean; cumplimientoPct?: number | null; objetivoPct?: number; esperaMaxMin?: number; enRiesgo?: number; muestra?: number; presupuestoConsumido?: number | null; cumple?: boolean | null };
interface Resumen { total: number; atendidos: number; tasaAbandono: number; percentiles: Pct[]; sla: Sla[]; csat: { promedio: number | null; pctSatisfechos: number | null; n: number } }
interface Heat { horas: number[]; matriz: { dia: string; celdas: { hora: number; valor: number; n: number; confiable: boolean }[] }[] }
interface Alerta { id: string; titulo: string; tipo: string; nivel: number; estado: string; ocurrencias: number; primeraVezAt: string; ultimaVezAt: string }
interface Regla { id: number; tipo: string; nombre: string; umbral: Record<string, number>; activa: boolean }
interface Prog { id: number; nombre: string; tipo: string; frecuencia: string; diaSemana: number | null; hora: string; formato: string[]; destinatarios: string[]; activo: boolean }
interface Gen { id: string; programado: string; periodo: string; estado: string; bytes: number; error: string | null; createdAt: string }

/** M7 · Analítica (percentiles, mapa de calor, SLA, CSAT), alertas y reportes programados. */
export default function Page() {
  const [tab, setTab] = useState<"analitica" | "alertas" | "reportes">("analitica");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "alertas" || t === "reportes") setTab(t);
  }, []);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  const hace = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date(Date.now() - 55 * 86400000));
  const [rango, setRango] = useState({ desde: hace, hasta: hoy });
  const [metrica, setMetrica] = useState("llegadas");
  const q = `desde=${rango.desde}&hasta=${rango.hasta}`;
  const res = useDatos<Resumen>(`/api/v1/analitica/resumen?${q}`, [q]);
  const heat = useDatos<Heat>(`/api/v1/analitica/heatmap?${q}&metrica=${metrica}`, [q, metrica]);
  const porHora = useDatos<Pct[]>(`/api/v1/analitica/percentiles?${q}&agrupar=hora`, [q]);
  const alertas = useDatos<{ items: Alerta[] }>(tab === "alertas" ? "/api/v1/alertas?estado=ABIERTA,RECONOCIDA,SILENCIADA" : null, [tab]);
  const historial = useDatos<{ items: Alerta[] }>(tab === "alertas" ? "/api/v1/alertas?estado=RESUELTA" : null, [tab]);
  const reglas = useDatos<Regla[]>(tab === "alertas" ? "/api/v1/alertas/reglas" : null, [tab]);
  const progs = useDatos<Prog[]>(tab === "reportes" ? "/api/v1/reportes-programados" : null, [tab]);
  const gens = useDatos<Gen[]>(tab === "reportes" ? "/api/v1/reportes-generados" : null, [tab]);
  const [slaEdit, setSlaEdit] = useState<Sla | null>(null);
  const [slaForm, setSlaForm] = useState({ esperaMaxMin: 15, objetivoPct: 90, ventanaMin: 60 });
  const [nuevoProg, setNuevoProg] = useState(false);
  const [pf, setPf] = useState({ nombre: "Resumen semanal", tipo: "SEMANAL_EJECUTIVO", frecuencia: "SEMANAL", diaSemana: 1, hora: "07:00", formato: ["PDF"], destinatarios: "" });
  useEffect(() => { if (slaEdit) setSlaForm({ esperaMaxMin: slaEdit.esperaMaxMin ?? 15, objetivoPct: slaEdit.objetivoPct ?? 90, ventanaMin: 60 }); }, [slaEdit]);

  const maxHeat = Math.max(1, ...(heat.datos?.matriz.flatMap((f) => f.celdas.map((c) => c.valor)) ?? [1]));
  const accionAlerta = async (id: string, a: string, hasta?: string) => { if (await accion(() => api(`/api/v1/alertas/${id}`, { method: "PATCH", json: { accion: a, hasta } }), "Alerta actualizada")) { void alertas.recargar(); void historial.recargar(); } };

  return (
    <div className="space-y-6">
      <PageHeader title="Analítica, SLA y alertas" description="Percentiles en vez de promedios, cumplimiento del SLA y alertas con escalamiento.">
        <Input type="date" aria-label="Desde" value={rango.desde} onChange={(e) => setRango({ ...rango, desde: e.target.value })} className="w-40" />
        <Input type="date" aria-label="Hasta" value={rango.hasta} max={hoy} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} className="w-40" />
        <Button asChild variant="outline"><a href={`/api/v1/reportes/pdf?${q}`}><Download className="size-4" /> PDF</a></Button>
      </PageHeader>
      <Pestanas valor={tab} onCambio={setTab} opciones={[{ valor: "analitica", etiqueta: "Analítica" }, { valor: "alertas", etiqueta: "Alertas", contador: alertas.datos?.items.filter((a) => a.estado === "ABIERTA").length }, { valor: "reportes", etiqueta: "Reportes programados" }]} />

      {tab === "analitica" && (
        <Estado cargando={res.cargando} error={res.error}>
          {res.datos && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi etiqueta="Turnos" valor={res.datos.total} />
                <Kpi etiqueta="Atendidos" valor={res.datos.atendidos} />
                <Kpi etiqueta="Abandono" valor={`${res.datos.tasaAbandono} %`} tono={res.datos.tasaAbandono > 15 ? "mal" : "default"} />
                <Kpi etiqueta="Satisfacción (CSAT)" valor={res.datos.csat.promedio != null ? `${res.datos.csat.promedio} / 5` : "—"} pista={res.datos.csat.n ? `${res.datos.csat.pctSatisfechos} % con 4–5 estrellas · ${res.datos.csat.n} valoraciones` : "sin valoraciones"} />
              </div>

              <Seccion titulo="SLA por cola" descripcion="Censura a la derecha: quien sigue esperando más del máximo ya cuenta como incumplimiento.">
                <div className="grid gap-3 md:grid-cols-3">
                  {res.datos.sla.map((s) => (
                    <div key={s.colaId} className="rounded-xl border p-4">
                      <div className="flex items-center justify-between"><p className="font-medium">{s.cola}</p><Button size="xs" variant="ghost" onClick={() => setSlaEdit(s)}>{s.configurado ? "Editar" : "Definir SLA"}</Button></div>
                      {s.configurado ? (
                        <>
                          <p className={`mt-1 text-3xl font-bold ${s.cumple === false ? "text-rose-700" : "text-emerald-700"}`}>{s.cumplimientoPct ?? "—"}{s.cumplimientoPct != null ? " %" : ""}</p>
                          <p className="text-xs text-muted-foreground">Objetivo {s.objetivoPct} % en ≤ {s.esperaMaxMin} min · {s.muestra} turnos · {s.enRiesgo} en riesgo</p>
                          {s.presupuestoConsumido != null && <div className="mt-2 h-1.5 rounded bg-muted"><div className={`h-1.5 rounded ${s.presupuestoConsumido > 1 ? "bg-rose-600" : "bg-teal-600"}`} style={{ width: `${Math.min(100, s.presupuestoConsumido * 100)}%` }} /></div>}
                        </>
                      ) : <p className="mt-1 text-sm text-muted-foreground">Sin SLA definido.</p>}
                    </div>
                  ))}
                </div>
              </Seccion>

              <Seccion titulo="Mapa de calor" acciones={<NativeSelect aria-label="Métrica" value={metrica} onChange={(e) => setMetrica(e.target.value)} className="w-48"><option value="llegadas">Llegadas medias</option><option value="espera_p90">Espera P90 (min)</option><option value="abandono">Abandono (%)</option></NativeSelect>}>
                <Estado cargando={heat.cargando} error={heat.error}>
                  <div className="overflow-x-auto">
                    <table className="text-xs" aria-label="Mapa de calor por día y hora">
                      <thead><tr><th />{heat.datos?.horas.map((h) => <th key={h} scope="col" className="w-10 px-1 font-normal text-muted-foreground">{h}</th>)}</tr></thead>
                      <tbody>
                        {heat.datos?.matriz.map((f) => (
                          <tr key={f.dia}>
                            <th scope="row" className="pr-2 text-left font-normal">{f.dia}</th>
                            {f.celdas.map((c) => (
                              <td key={c.hora} className="p-0.5">
                                <div title={`${f.dia} ${c.hora}:00 · ${c.valor} (n = ${c.n})`} className="flex h-8 w-10 items-center justify-center rounded" style={{ background: `rgba(15,118,110,${c.valor / maxHeat})`, color: c.valor / maxHeat > 0.5 ? "white" : "inherit", opacity: c.confiable ? 1 : 0.5 }}>{c.valor || ""}</div>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Estado>
              </Seccion>

              <div className="grid gap-6 lg:grid-cols-2">
                <Seccion titulo="Percentiles por cola (min)" acciones={<Button size="xs" variant="outline" onClick={() => descargarCsv("percentiles.csv", [["cola", "n", "p50", "p90", "p95"], ...res.datos!.percentiles.map((p) => [p.grupo, p.n, p.espera.p50, p.espera.p90, p.espera.p95])])}>CSV</Button>}>
                  <Tabla columnas={["Cola", "n", "Espera P50", "P90", "P95", "Atención P50", "P90"]} filas={res.datos.percentiles.map((p) => [p.grupo, p.n, p.espera.p50, p.espera.p90, p.espera.p95, p.atencion.p50, p.atencion.p90])} />
                </Seccion>
                <Seccion titulo="Espera por hora (P50 y P90)">
                  <div className="h-60">
                    <ResponsiveContainer>
                      <BarChart data={porHora.datos ?? []}>
                        <XAxis dataKey="grupo" fontSize={11} />
                        <YAxis unit=" min" width={50} fontSize={11} />
                        <Tooltip />
                        <Bar dataKey="espera.p50" name="P50" fill="#5eead4" />
                        <Bar dataKey="espera.p90" name="P90" fill="#0f766e" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Seccion>
              </div>
            </>
          )}
        </Estado>
      )}

      {tab === "alertas" && (
        <div className="space-y-6">
          <Seccion titulo="Alertas activas">
            <Estado cargando={alertas.cargando} error={alertas.error}>
              <Tabla columnas={["Alerta", "Nivel", "Estado", "Desde", "Ocurrencias", ""]} vacio="Todo en orden: no hay alertas activas." filas={(alertas.datos?.items ?? []).map((a) => [
                <span key="t"><b>{a.titulo}</b><span className="block text-xs text-muted-foreground">{a.tipo}</span></span>,
                <Badge key="n" className={a.nivel >= 3 ? "bg-rose-100 text-rose-800" : a.nivel === 2 ? "bg-amber-100 text-amber-800" : "bg-muted"}>N{a.nivel}</Badge>,
                a.estado, fmtFechaHora(a.primeraVezAt), a.ocurrencias,
                <div key="a" className="flex flex-wrap gap-1">
                  {a.estado === "ABIERTA" && <Button size="xs" onClick={() => accionAlerta(a.id, "RECONOCER")}>Reconocer</Button>}
                  <Button size="xs" variant="outline" onClick={() => accionAlerta(a.id, "RESOLVER")}>Resolver</Button>
                  <Button size="xs" variant="ghost" onClick={() => accionAlerta(a.id, "SILENCIAR", new Date(Date.now() + 3600_000).toISOString())}>Silenciar 1 h</Button>
                </div>,
              ])} />
            </Estado>
          </Seccion>
          <div className="grid gap-6 lg:grid-cols-2">
            <Seccion titulo="Reglas" descripcion="Niveles: 0 min en la app, 10 min WhatsApp al local, 30 min correo a los administradores.">
              <Tabla columnas={["Regla", "Umbral", "Activa"]} filas={(reglas.datos ?? []).map((r) => [
                r.nombre, Object.entries(r.umbral).map(([k, v]) => `${k}: ${v}`).join(", ") || "—",
                <input key="a" type="checkbox" aria-label={`Activar ${r.nombre}`} checked={r.activa} onChange={async (e) => { if (await accion(() => api(`/api/v1/alertas/reglas/${r.id}`, { method: "PATCH", json: { activa: e.target.checked } }))) void reglas.recargar(); }} />,
              ])} />
            </Seccion>
            <Seccion titulo="Historial">
              <Tabla columnas={["Alerta", "Desde", "Resuelta", ""]} vacio="Sin alertas resueltas." filas={(historial.datos?.items ?? []).slice(0, 20).map((a) => [a.titulo, fmtFechaHora(a.primeraVezAt), fmtFechaHora(a.ultimaVezAt), <Button key="r" size="xs" variant="ghost" onClick={() => accionAlerta(a.id, "REABRIR")}>Reabrir</Button>])} />
            </Seccion>
          </div>
        </div>
      )}

      {tab === "reportes" && (
        <div className="space-y-6">
          <Seccion titulo="Programaciones" acciones={<Button onClick={() => setNuevoProg(true)}><Plus className="size-4" /> Nueva</Button>}>
            <Estado cargando={progs.cargando} error={progs.error}>
              <Tabla columnas={["Nombre", "Frecuencia", "Hora", "Formato", "Destinatarios", ""]} vacio="Sin reportes programados." filas={(progs.datos ?? []).map((p) => [
                p.nombre, p.frecuencia, p.hora, p.formato.join(", "), p.destinatarios.join(", "),
                <div key="a" className="flex gap-1">
                  <Button size="xs" onClick={async () => { const r = await accion(() => api<{ enviado: boolean } | null>(`/api/v1/reportes-programados/${p.id}/ejecutar`, { method: "POST" })); if (r) { const { toast } = await import("sonner"); toast.success(r.enviado ? "Reporte generado y enviado" : "Reporte generado (sin SMTP: descárgalo abajo)"); void gens.recargar(); } }}>Ejecutar ahora</Button>
                  <Button size="xs" variant="ghost" className="text-rose-700" onClick={async () => { if (await accion(() => api(`/api/v1/reportes-programados/${p.id}`, { method: "DELETE" }), "Eliminado")) void progs.recargar(); }}>Eliminar</Button>
                </div>,
              ])} />
            </Estado>
          </Seccion>
          <Seccion titulo="Reportes generados">
            <Tabla columnas={["Fecha", "Reporte", "Periodo", "Estado", "Tamaño", ""]} vacio="Aún no se generó ningún reporte." filas={(gens.datos ?? []).map((g) => [
              fmtFechaHora(g.createdAt), g.programado, g.periodo, <span key="e" title={g.error ?? ""}>{g.estado}</span>, `${Math.round(g.bytes / 1024)} KB`,
              g.bytes ? <a key="d" className="text-teal-700 underline" href={`/api/v1/reportes-generados/${g.id}/descargar`}>Descargar</a> : null,
            ])} />
          </Seccion>
        </div>
      )}

      <Modal abierto={!!slaEdit} titulo={`SLA de ${slaEdit?.cola ?? ""}`} onCerrar={() => setSlaEdit(null)}>
        <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); if (await accion(() => api(`/api/v1/sla/${slaEdit!.colaId}`, { method: "PUT", json: slaForm }), "SLA guardado")) { setSlaEdit(null); void res.recargar(); } }}>
          <div><Label htmlFor="sm">Espera máxima (min)</Label><Input id="sm" type="number" min={1} value={slaForm.esperaMaxMin} onChange={(e) => setSlaForm({ ...slaForm, esperaMaxMin: Number(e.target.value) })} /></div>
          <div><Label htmlFor="so">Objetivo (%)</Label><Input id="so" type="number" min={1} max={100} value={slaForm.objetivoPct} onChange={(e) => setSlaForm({ ...slaForm, objetivoPct: Number(e.target.value) })} /></div>
          <div><Label htmlFor="sv">Ventana móvil (min)</Label><Input id="sv" type="number" min={15} value={slaForm.ventanaMin} onChange={(e) => setSlaForm({ ...slaForm, ventanaMin: Number(e.target.value) })} /></div>
          <Button type="submit">Guardar</Button>
        </form>
      </Modal>
      <Modal abierto={nuevoProg} titulo="Nuevo reporte programado" onCerrar={() => setNuevoProg(false)}>
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          const json = { ...pf, diaSemana: pf.frecuencia === "SEMANAL" ? pf.diaSemana : null, diaMes: pf.frecuencia === "MENSUAL" ? 1 : null, destinatarios: pf.destinatarios.split(",").map((x) => x.trim()).filter(Boolean) };
          if (await accion(() => api("/api/v1/reportes-programados", { method: "POST", json }), "Programado")) { setNuevoProg(false); void progs.recargar(); }
        }}>
          <Input aria-label="Nombre" value={pf.nombre} onChange={(e) => setPf({ ...pf, nombre: e.target.value })} />
          <NativeSelect aria-label="Frecuencia" value={pf.frecuencia} onChange={(e) => setPf({ ...pf, frecuencia: e.target.value, tipo: e.target.value === "DIARIO" ? "OPERATIVO_DIARIO" : e.target.value === "SEMANAL" ? "SEMANAL_EJECUTIVO" : "MENSUAL" })}>
            <option value="DIARIO">Diario</option><option value="SEMANAL">Semanal (lunes)</option><option value="MENSUAL">Mensual (día 1)</option>
          </NativeSelect>
          <Input type="time" aria-label="Hora" value={pf.hora} onChange={(e) => setPf({ ...pf, hora: e.target.value })} />
          <Input aria-label="Destinatarios" placeholder="correo1@local.pe, correo2@local.pe" value={pf.destinatarios} onChange={(e) => setPf({ ...pf, destinatarios: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pf.formato.includes("CSV")} onChange={(e) => setPf({ ...pf, formato: e.target.checked ? ["PDF", "CSV"] : ["PDF"] })} /> Adjuntar también CSV</label>
          <Button type="submit">Programar</Button>
        </form>
      </Modal>
    </div>
  );
}
