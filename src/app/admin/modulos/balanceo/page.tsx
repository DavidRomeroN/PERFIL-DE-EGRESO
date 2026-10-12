"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/app/page-header";
import { Estado, Modal, Pestanas, Seccion, Tabla, accion, descargarCsv, fmtFechaHora, useDatos } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

interface Carga { colas: ({ colaId: number; cola: string } & Record<string, number | string>)[]; ventanillas: { id: number; nombre: string; activa: boolean; cola: string; atendidosHoy: number; atendiendo: string | null; temporal: boolean }[] }
interface Regla { id: number; nombre: string; activa: boolean; modo: string; condicion: { metric?: string; op?: string; value?: number; scope?: { cola?: number } }; accion: { tipo: string; desdeColaId?: number; haciaColaId?: number }; forSegundos: number; cooldownSeg: number; histeresisPct: number; requiereConfirmacion: boolean; estado: { fase: string } | null }
interface Ejecucion { id: string; regla: string; ts: string; fase: string; resultado: string; detalle: Record<string, string> | null }

const METRICAS: [string, string][] = [["espera_prom_min", "Espera promedio (min)"], ["espera_max_min", "Espera máxima (min)"], ["en_espera", "Personas en espera"], ["utilizacion", "Utilización (0–1)"], ["tasa_llegada_15m", "Llegadas en 15 min"]];

/** M6 · Mapa de carga, reglas con simulación/histéresis, historial y confirmaciones. */
export default function Page() {
  const [tab, setTab] = useState<"carga" | "reglas" | "historial">("carga");
  const carga = useDatos<Carga>("/api/v1/balanceo/carga");
  const reglas = useDatos<Regla[]>("/api/v1/balanceo/reglas");
  const ejec = useDatos<{ items: Ejecucion[] }>(tab === "historial" ? "/api/v1/balanceo/ejecuciones" : null, [tab]);
  const [nueva, setNueva] = useState(false);
  const colas = carga.datos?.colas ?? [];
  const [f, setF] = useState({ nombre: "Refuerzo", metric: "espera_prom_min", cola: 0, op: ">", value: 20, desde: 0, hacia: 0, forMin: 5, cooldownMin: 10, histeresis: 20, confirmar: false });
  const pendientes = ejec.datos?.items.filter((e) => e.resultado === "PENDIENTE_CONFIRMACION") ?? [];
  const nombreCola = (id?: number) => colas.find((c) => c.colaId === id)?.cola ?? `#${id}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Transferencia y balanceo" description="Las reglas nacen en modo simulación: registran qué harían sin mover a nadie hasta que las actives.">
        <Button variant="outline" onClick={async () => { const r = await accion(() => api<{ movido: boolean; ventanilla?: string }>("/api/v1/balanceo", { method: "POST" })); if (r) { const { toast } = await import("sonner"); toast[r.movido ? "success" : "info"](r.movido ? `Se movió ${r.ventanilla}` : "La carga ya está equilibrada"); void carga.recargar(); } }}>Balancear ahora</Button>
        <Button onClick={() => { setF({ ...f, cola: colas[0]?.colaId ?? 0, hacia: colas[0]?.colaId ?? 0, desde: colas[1]?.colaId ?? 0 }); setNueva(true); }}><Plus className="size-4" /> Nueva regla</Button>
      </PageHeader>
      <Pestanas valor={tab} onCambio={setTab} opciones={[{ valor: "carga", etiqueta: "Carga en vivo" }, { valor: "reglas", etiqueta: "Reglas" }, { valor: "historial", etiqueta: "Historial", contador: pendientes.length }]} />

      {tab === "carga" && (
        <Estado cargando={carga.cargando} error={carga.error}>
          <div className="grid gap-4 lg:grid-cols-2">
            <Seccion titulo="Por cola" acciones={<Button size="xs" variant="ghost" onClick={() => void carga.recargar()}>Actualizar</Button>}>
              <Tabla columnas={["Cola", "En espera", "Espera máx.", "Espera prom.", "Ventanillas", "Utilización"]} filas={colas.map((c) => [
                c.cola, c.en_espera, `${c.espera_max_min} min`, `${c.espera_prom_min} min`, `${c.ventanillas_operativas} (${c.ventanillas_libres} libres)`,
                <span key="u" className={Number(c.utilizacion) > 0.9 ? "font-semibold text-rose-700" : Number(c.utilizacion) > 0.75 ? "text-amber-700" : "text-emerald-700"}>{Math.round(Number(c.utilizacion) * 100)} %</span>,
              ])} />
            </Seccion>
            <Seccion titulo="Por ventanilla">
              <Tabla columnas={["Ventanilla", "Cola", "Atendiendo", "Atendidos hoy"]} filas={(carga.datos?.ventanillas ?? []).map((v) => [
                <span key="n">{v.nombre}{v.temporal && <Badge className="ml-1 bg-amber-100 text-amber-800">temporal</Badge>}{!v.activa && <Badge variant="outline" className="ml-1">inactiva</Badge>}</span>, v.cola, v.atendiendo ?? "—", v.atendidosHoy,
              ])} />
            </Seccion>
          </div>
        </Estado>
      )}

      {tab === "reglas" && (
        <Estado cargando={reglas.cargando} error={reglas.error} vacio={!reglas.datos?.length} mensajeVacio="Sin reglas. Ejemplo: “si la espera en Medicina supera 20 min por 5 min, mueve una ventanilla de Caja”.">
          <div className="space-y-3">
            {reglas.datos?.map((r) => (
              <Seccion key={r.id} titulo={r.nombre} descripcion={`Si ${METRICAS.find((m) => m[0] === r.condicion.metric)?.[1] ?? r.condicion.metric} ${r.condicion.op} ${r.condicion.value}${r.condicion.scope?.cola ? ` en ${nombreCola(r.condicion.scope.cola)}` : ""} durante ${Math.round(r.forSegundos / 60)} min ⇒ ${r.accion.tipo === "MOVER_OPERADOR" ? `mover ventanilla de ${nombreCola(r.accion.desdeColaId)} a ${nombreCola(r.accion.haciaColaId)}` : r.accion.tipo}`}
                acciones={<>
                  <Badge className={r.modo === "ACTIVA" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}>{r.modo === "ACTIVA" ? "Activa" : "Simulación"}</Badge>
                  {r.estado && <Badge variant="outline">{r.estado.fase}</Badge>}
                  <Button size="xs" variant="outline" onClick={async () => { const p = await accion(() => api<{ haria: string }>(`/api/v1/balanceo/reglas/${r.id}/probar`, { method: "POST" })); if (p) { const { toast } = await import("sonner"); toast.info(p.haria); } }}>Probar ahora</Button>
                  <Button size="xs" variant={r.modo === "ACTIVA" ? "outline" : "default"} onClick={async () => { if (await accion(() => api(`/api/v1/balanceo/reglas/${r.id}`, { method: "PATCH", json: { modo: r.modo === "ACTIVA" ? "SIMULACION" : "ACTIVA" } }), "Regla actualizada")) void reglas.recargar(); }}>{r.modo === "ACTIVA" ? "Pasar a simulación" : "Activar"}</Button>
                  <Switch aria-label="Encendida" checked={r.activa} onCheckedChange={async (v) => { if (await accion(() => api(`/api/v1/balanceo/reglas/${r.id}`, { method: "PATCH", json: { activa: v } }))) void reglas.recargar(); }} />
                  <Button size="xs" variant="ghost" className="text-rose-700" onClick={async () => { if (await accion(() => api(`/api/v1/balanceo/reglas/${r.id}`, { method: "DELETE" }), "Regla eliminada")) void reglas.recargar(); }}>Eliminar</Button>
                </>}>
                <p className="text-xs text-muted-foreground">Enfriamiento {Math.round(r.cooldownSeg / 60)} min · histéresis {r.histeresisPct} %{r.requiereConfirmacion ? " · requiere confirmación" : ""}</p>
              </Seccion>
            ))}
          </div>
        </Estado>
      )}

      {tab === "historial" && (
        <Seccion titulo="Ejecuciones" acciones={<Button size="sm" variant="outline" onClick={() => descargarCsv("balanceo.csv", [["fecha", "regla", "fase", "resultado"], ...(ejec.datos?.items ?? []).map((e) => [e.ts, e.regla, e.fase, e.resultado])])}>Exportar CSV</Button>}>
          <Estado cargando={ejec.cargando} error={ejec.error}>
            <Tabla columnas={["Fecha", "Regla", "Fase", "Resultado", "Detalle", ""]} vacio="Aún no hay ejecuciones." filas={(ejec.datos?.items ?? []).map((e) => [
              fmtFechaHora(e.ts), e.regla, e.fase, e.resultado, e.detalle ? Object.values(e.detalle).join(" ") : "",
              e.resultado === "PENDIENTE_CONFIRMACION" ? (
                <div key="c" className="flex gap-1">
                  <Button size="xs" onClick={async () => { if (await accion(() => api(`/api/v1/balanceo/ejecuciones/${e.id}/confirmar`, { method: "POST", json: { aprobar: true } }), "Acción ejecutada")) void ejec.recargar(); }}>Aprobar</Button>
                  <Button size="xs" variant="ghost" onClick={async () => { if (await accion(() => api(`/api/v1/balanceo/ejecuciones/${e.id}/confirmar`, { method: "POST", json: { aprobar: false } }), "Rechazada")) void ejec.recargar(); }}>Rechazar</Button>
                </div>
              ) : null,
            ])} />
          </Estado>
        </Seccion>
      )}

      <Modal abierto={nueva} titulo="Nueva regla de balanceo" onCerrar={() => setNueva(false)}>
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          const json = {
            nombre: f.nombre,
            condicion: { metric: f.metric, scope: { cola: f.cola }, op: f.op, value: f.value },
            accion: { tipo: "MOVER_OPERADOR", desdeColaId: f.desde, haciaColaId: f.hacia },
            forSegundos: f.forMin * 60, cooldownSeg: Math.max(120, f.cooldownMin * 60), histeresisPct: f.histeresis, requiereConfirmacion: f.confirmar,
          };
          if (await accion(() => api("/api/v1/balanceo/reglas", { method: "POST", json }), "Regla creada en modo simulación")) { setNueva(false); void reglas.recargar(); setTab("reglas"); }
        }}>
          <div><Label htmlFor="rn">Nombre</Label><Input id="rn" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
          <p className="text-sm font-medium">Cuando…</p>
          <div className="grid grid-cols-3 gap-2">
            <NativeSelect aria-label="Métrica" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}>{METRICAS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
            <NativeSelect aria-label="Operador" value={f.op} onChange={(e) => setF({ ...f, op: e.target.value })}>{[">", ">=", "<", "<="].map((o) => <option key={o}>{o}</option>)}</NativeSelect>
            <Input aria-label="Valor" type="number" step="0.1" value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} />
          </div>
          <NativeSelect aria-label="En la cola" value={f.cola} onChange={(e) => setF({ ...f, cola: Number(e.target.value), hacia: Number(e.target.value) })}>{colas.map((c) => <option key={c.colaId} value={c.colaId}>en {c.cola}</option>)}</NativeSelect>
          <div><Label htmlFor="fm">durante (min)</Label><Input id="fm" type="number" min={0} value={f.forMin} onChange={(e) => setF({ ...f, forMin: Number(e.target.value) })} /></div>
          <p className="text-sm font-medium">…mover una ventanilla</p>
          <div className="grid grid-cols-2 gap-2">
            <NativeSelect aria-label="Desde" value={f.desde} onChange={(e) => setF({ ...f, desde: Number(e.target.value) })}>{colas.map((c) => <option key={c.colaId} value={c.colaId}>desde {c.cola}</option>)}</NativeSelect>
            <NativeSelect aria-label="Hacia" value={f.hacia} onChange={(e) => setF({ ...f, hacia: Number(e.target.value) })}>{colas.map((c) => <option key={c.colaId} value={c.colaId}>hacia {c.cola}</option>)}</NativeSelect>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="cd">Enfriamiento (min)</Label><Input id="cd" type="number" min={2} value={f.cooldownMin} onChange={(e) => setF({ ...f, cooldownMin: Number(e.target.value) })} /></div>
            <div><Label htmlFor="hi">Histéresis (%)</Label><Input id="hi" type="number" min={0} max={80} value={f.histeresis} onChange={(e) => setF({ ...f, histeresis: Number(e.target.value) })} /></div>
          </div>
          <label className="flex items-center justify-between text-sm">Pedir confirmación antes de ejecutar <Switch checked={f.confirmar} onCheckedChange={(v) => setF({ ...f, confirmar: v })} /></label>
          <Button type="submit">Crear (en simulación)</Button>
        </form>
      </Modal>
    </div>
  );
}
