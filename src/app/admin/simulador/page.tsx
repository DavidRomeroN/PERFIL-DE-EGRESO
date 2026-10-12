"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/app/page-header";
import { Kpi, Pestanas, Seccion, Tabla, accion, descargarCsv, useDatos } from "@/components/app/modulo-ui";
import { erlangC, minimoServidores, nivelServicio, percentilEspera, tablaServidores } from "@/lib/capacidad/erlang";
import { monteCarlo, type ParametrosSim, type ResultadoMonteCarlo } from "@/lib/capacidad/des";
import { api } from "@/lib/fetcher";

interface Calib { confianza: string; n: number; parametros: Omit<ParametrosSim, "sla" | "replicas" | "semilla">; avisos: string[] }
interface DiaBt { fecha: string; apertura: string; cierre: string; lambdaPorHora: { desde: string; valor: number }[]; ventanillas: { desde: string; c: number }[]; observado: { esperaMedia: number; esperaP90: number; n: number } }
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const min = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "∞" : `${x.toFixed(1)} min`);

/** M8 · Dimensionamiento: Erlang C analítico + simulación de eventos discretos con IC, comparación, sensibilidad, calibración y backtest. */
export default function Page() {
  const [tab, setTab] = useState<"escenario" | "comparar" | "backtest" | "guardados">("escenario");
  const [p, setP] = useState({ lambda: 30, servicio: 5, cv: 0.6, c: 3, slaMin: 15, objetivo: 90, paciencia: 0, noShow: 8, replicas: 500, semilla: 2026, apertura: "08:00", cierre: "17:00", costoVentanilla: 12.5, costoEspera: 0.4 });
  const [curva, setCurva] = useState<ParametrosSim["lambdaPorHora"] | null>(null);
  const [calVent, setCalVent] = useState<ParametrosSim["ventanillas"] | null>(null);
  const [muestras, setMuestras] = useState<number[] | null>(null);
  const [sim, setSim] = useState<ResultadoMonteCarlo | null>(null);
  const [progreso, setProgreso] = useState<number | null>(null);
  const [torn, setTorn] = useState<{ factor: string; deltaSl: number }[] | null>(null);
  const [colaId, setColaId] = useState<number | null>(null);
  const [cal, setCal] = useState<Calib | null>(null);
  const [bt, setBt] = useState<{ fecha: string; obs: number; simu: number; obsP90: number; simP90: number; error: number }[] | null>(null);
  const colas = useDatos<{ id: number; nombre: string }[]>("/api/v1/colas");
  const guardados = useDatos<{ id: number; nombre: string; semilla: number; createdAt: string; resultados: { pctSla?: number } | null }[]>(tab === "guardados" ? "/api/v1/simulador/escenarios" : null, [tab]);
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    if (!colaId && colas.datos?.length) setColaId(colas.datos[0].id);
  }, [colas.datos, colaId]);

  const analitico = useMemo(() => {
    const r = erlangC(p.lambda, p.servicio, p.c);
    return {
      ...r,
      sl: r.estable ? nivelServicio(p.lambda, p.servicio, p.c, p.slaMin) : 0,
      p90: r.estable ? percentilEspera(p.lambda, p.servicio, p.c, 0.9) : null,
      minimo: minimoServidores(p.lambda, p.servicio, p.slaMin, p.objetivo / 100),
    };
  }, [p]);
  const tabla = useMemo(() => tablaServidores(p.lambda, p.servicio, p.slaMin, Math.max(1, analitico.minimo - 2), analitico.minimo + 3), [p, analitico.minimo]);

  const parametros = (c = p.c): ParametrosSim => ({
    version: 1,
    modo: "DIA",
    horario: { apertura: p.apertura, cierre: p.cierre },
    lambdaPorHora: curva ?? [{ desde: p.apertura, valor: p.lambda }],
    servicio: muestras ? { tipo: "EMPIRICA", mediaMin: p.servicio, muestras } : { tipo: "LOGNORMAL", mediaMin: p.servicio, cv: p.cv },
    ventanillas: calVent && c === p.c ? calVent : [{ desde: p.apertura, c }],
    pacienciaMin: p.paciencia > 0 ? { tipo: "EXPONENCIAL", media: p.paciencia } : null,
    noShow: p.noShow > 0 ? { p: p.noShow / 100, minutos: 3 } : null,
    sla: { esperaMaxMin: p.slaMin, objetivoPct: p.objetivo },
    costos: { ventanillaHora: p.costoVentanilla, esperaMinuto: p.costoEspera },
    replicas: Math.min(5000, p.replicas),
    semilla: p.semilla,
  });

  function simular() {
    setSim(null);
    setProgreso(0);
    try {
      worker.current?.terminate();
      const w = new Worker(new URL("../../../lib/capacidad/simulador.worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      w.onmessage = (e) => {
        if (e.data.tipo === "PROGRESO") setProgreso(e.data.pct);
        if (e.data.tipo === "RESULTADO") { setSim(e.data.datos); setProgreso(null); }
        if (e.data.tipo === "TORNADO") setTorn(e.data.datos);
        if (e.data.tipo === "CANCELADO") setProgreso(null);
      };
      w.postMessage({ tipo: "EJECUTAR", parametros: parametros() });
    } catch {
      // Respaldo sin Worker: hilo principal
      setTimeout(() => { setSim(monteCarlo(parametros())); setProgreso(null); }, 0);
    }
  }

  async function calibrar() {
    if (!colaId) return;
    const r = await accion(() => api<Calib>(`/api/v1/simulador/calibracion?colaId=${colaId}&dias=28`));
    if (!r) return;
    setCal(r);
    const lam = r.parametros.lambdaPorHora;
    const media = lam.reduce((a, x) => a + x.valor, 0) / Math.max(1, lam.length);
    setCurva(lam);
    setCalVent(r.parametros.ventanillas);
    setMuestras(r.parametros.servicio.muestras ?? null);
    setP({ ...p, lambda: Math.round(media), servicio: r.parametros.servicio.mediaMin, cv: r.parametros.servicio.cv ?? 0.6, apertura: r.parametros.horario.apertura, cierre: r.parametros.horario.cierre, c: Math.max(1, Math.round(r.parametros.ventanillas.reduce((a, v) => a + v.c, 0) / r.parametros.ventanillas.length)), noShow: Math.round((r.parametros.noShow?.p ?? 0) * 100), paciencia: r.parametros.pacienciaMin?.media ?? 0 });
  }

  async function backtest() {
    if (!colaId) return;
    const dias = await accion(() => api<DiaBt[]>(`/api/v1/simulador/backtest?colaId=${colaId}&dias=14`));
    if (!dias) return;
    setBt(dias.map((d) => {
      const r = monteCarlo({ ...parametros(), horario: { apertura: d.apertura, cierre: d.cierre }, lambdaPorHora: d.lambdaPorHora, ventanillas: d.ventanillas.length ? d.ventanillas : [{ desde: d.apertura, c: 1 }], replicas: 100 })!;
      const error = d.observado.esperaMedia > 0 ? Math.abs(r.esperaMedia.media - d.observado.esperaMedia) / d.observado.esperaMedia : 0;
      return { fecha: d.fecha, obs: d.observado.esperaMedia, simu: r.esperaMedia.media, obsP90: d.observado.esperaP90, simP90: r.esperaP90.media, error };
    }));
  }

  const num = (k: keyof typeof p, etiqueta: string, paso = 1) => (
    <div><Label htmlFor={k} className="text-xs">{etiqueta}</Label><Input id={k} type="number" step={paso} value={p[k] as number} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} /></div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Simulador de capacidad" description="¿Cuántas ventanillas necesito para que casi todos esperen menos de X minutos?">
        <NativeSelect aria-label="Cola para calibrar" value={colaId ?? ""} onChange={(e) => setColaId(Number(e.target.value))} className="w-44">{colas.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</NativeSelect>
        <Button variant="outline" onClick={calibrar}>Cargar del histórico</Button>
      </PageHeader>
      {cal && <p className="rounded-xl bg-muted p-3 text-sm">Calibrado con {cal.n} atenciones · confianza <b>{cal.confianza}</b>{cal.avisos.length ? ` · ${cal.avisos.join(" ")}` : ""} <button type="button" className="ml-2 underline" onClick={() => { setCal(null); setCurva(null); setCalVent(null); setMuestras(null); }}>Quitar</button></p>}
      <Pestanas valor={tab} onCambio={setTab} opciones={[{ valor: "escenario", etiqueta: "Escenario" }, { valor: "comparar", etiqueta: "Comparar" }, { valor: "backtest", etiqueta: "Validación con el pasado" }, { valor: "guardados", etiqueta: "Guardados" }]} />

      {tab === "escenario" && (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Seccion titulo="Parámetros">
            <div className="grid grid-cols-2 gap-3">
              {num("lambda", "Llegadas por hora")}
              {num("servicio", "Atención media (min)", 0.1)}
              {num("cv", "Variabilidad (CV)", 0.1)}
              {num("slaMin", "SLA: espera máx. (min)")}
              {num("objetivo", "SLA: objetivo (%)")}
              {num("paciencia", "Paciencia media (0 = sin abandono)")}
              {num("noShow", "No se presentan (%)")}
              {num("replicas", "Réplicas")}
              {num("semilla", "Semilla")}
              {num("costoVentanilla", "S/ por ventanilla-hora", 0.5)}
            </div>
            <div className="mt-4">
              <Label className="text-xs">Ventanillas</Label>
              <div className="mt-1 flex items-center gap-3">
                <Button size="icon" variant="outline" aria-label="Quitar ventanilla" onClick={() => setP({ ...p, c: Math.max(1, p.c - 1) })}><Minus className="size-4" /></Button>
                <span className="w-10 text-center text-3xl font-bold tabular-nums">{p.c}</span>
                <Button size="icon" variant="outline" aria-label="Agregar ventanilla" onClick={() => setP({ ...p, c: p.c + 1 })}><Plus className="size-4" /></Button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={simular} disabled={progreso !== null}>Simular</Button>
              {progreso !== null && <Button variant="outline" onClick={() => worker.current?.postMessage({ tipo: "CANCELAR" })}>Cancelar {progreso} %</Button>}
              <Button variant="outline" onClick={() => { setTorn(null); try { const w = new Worker(new URL("../../../lib/capacidad/simulador.worker.ts", import.meta.url), { type: "module" }); w.onmessage = (e) => { if (e.data.tipo === "TORNADO") { setTorn(e.data.datos); w.terminate(); } }; w.postMessage({ tipo: "TORNADO", parametros: parametros() }); } catch { /* sin worker */ } }}>Sensibilidad</Button>
              <Button variant="ghost" onClick={async () => { if (await accion(() => api("/api/v1/simulador/escenarios", { method: "POST", json: { nombre: `${p.c} ventanillas · λ ${p.lambda}/h`, colaId, parametros: parametros(), resultados: sim ? { pctSla: sim.pctSla.media, esperaMedia: sim.esperaMedia.media } : undefined, semilla: p.semilla } }), "Escenario guardado")) void guardados.recargar(); }}>Guardar</Button>
            </div>
          </Seccion>

          <div className="space-y-6">
            <Seccion titulo="Resultado analítico (Erlang C)" acciones={<Badge className={!analitico.estable ? "bg-rose-100 text-rose-800" : analitico.sl * 100 >= p.objetivo ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{!analitico.estable ? "Sistema inestable" : analitico.sl * 100 >= p.objetivo ? "Cumple" : "No cumple"}</Badge>}>
              {!analitico.estable && <p className="mb-3 text-sm text-rose-700">Con {p.c} ventanillas llegan más clientes de los que se pueden atender: la cola crece sin límite.</p>}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Kpi etiqueta="Ocupación ρ" valor={pct(analitico.ocupacion)} tono={analitico.ocupacion > 0.85 ? "alerta" : "default"} />
                <Kpi etiqueta="P(esperar)" valor={pct(analitico.probabilidadEspera)} />
                <Kpi etiqueta="Espera media" valor={min(analitico.esperaMin)} />
                <Kpi etiqueta="P90 de espera" valor={min(analitico.p90)} />
                <Kpi etiqueta={`Atendidos en ≤ ${p.slaMin} min`} valor={pct(analitico.sl)} tono={analitico.sl * 100 >= p.objetivo ? "bien" : "mal"} />
              </div>
              <p className="mt-3 text-sm">Recomendación: <b>{analitico.minimo} ventanillas</b> para el {p.objetivo} % en {p.slaMin} min con ocupación ≤ 85 %.</p>
            </Seccion>

            {sim && (
              <Seccion titulo={`Simulación (${sim.replicas} réplicas, semilla ${sim.semilla})`} acciones={<Badge className={sim.cumpleSla ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{sim.cumpleSla ? "Cumple" : "No cumple"}</Badge>}>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <Kpi etiqueta="Espera media" valor={min(sim.esperaMedia.media)} pista={`IC 95 %: ${sim.esperaMedia.ic.map((x) => x.toFixed(1)).join("–")}`} />
                  <Kpi etiqueta="P90" valor={min(sim.esperaP90.media)} />
                  <Kpi etiqueta="Cumplen SLA" valor={pct(sim.pctSla.media)} pista={`IC 95 %: ${sim.pctSla.ic.map((x) => (x * 100).toFixed(1)).join("–")} %`} tono={sim.cumpleSla ? "bien" : "mal"} />
                  <Kpi etiqueta="Abandono" valor={pct(sim.abandonoPct.media)} />
                  <Kpi etiqueta="Costo del día" valor={`S/ ${sim.costo.media.toFixed(0)}`} pista={`quedan ${sim.backlog.media.toFixed(1)} al cierre`} />
                </div>
                <div className="mt-4 h-48">
                  <ResponsiveContainer>
                    <BarChart data={sim.histograma.filter((h) => h.n > 0)}>
                      <XAxis dataKey="min" unit=" m" fontSize={11} />
                      <YAxis hide />
                      <Tooltip />
                      <ReferenceLine x={p.slaMin} stroke="#e11d48" label={{ value: "SLA", fontSize: 11 }} />
                      <Bar dataKey="n" name="Clientes" fill="#0f766e" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Seccion>
            )}

            {torn && (
              <Seccion titulo="Sensibilidad (cambio del % que cumple el SLA)">
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={torn.map((t) => ({ ...t, delta: Math.round(t.deltaSl * 1000) / 10 }))} layout="vertical" margin={{ left: 60 }}>
                      <XAxis type="number" unit=" pp" fontSize={11} />
                      <YAxis type="category" dataKey="factor" width={110} fontSize={11} />
                      <Tooltip />
                      <ReferenceLine x={0} stroke="#64748b" />
                      <Bar dataKey="delta" fill="#0f766e" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Seccion>
            )}
          </div>
        </div>
      )}

      {tab === "comparar" && (
        <Seccion titulo="Ventanillas vs. nivel de servicio" acciones={<Button size="sm" variant="outline" onClick={() => descargarCsv("comparacion.csv", [["c", "ocupacion", "espera_media", "p90", "nivel_servicio"], ...tabla.map((t) => [t.c, t.ocupacion.toFixed(3), t.esperaMin?.toFixed(2), t.p90Min?.toFixed(2), t.nivelServicio.toFixed(3)])])}>CSV</Button>}>
          <div className="mb-4 h-56">
            <ResponsiveContainer>
              <LineChart data={tabla.map((t) => ({ c: t.c, sl: Math.round(t.nivelServicio * 1000) / 10 }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="c" fontSize={11} />
                <YAxis unit=" %" domain={[0, 100]} fontSize={11} />
                <Tooltip />
                <ReferenceLine y={p.objetivo} stroke="#e11d48" />
                <Line dataKey="sl" stroke="#0f766e" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Tabla columnas={["Ventanillas", "Ocupación", "Espera media", "P90", `≤ ${p.slaMin} min`, "Costo/hora"]} filas={tabla.map((t) => [
            <b key="c" className={t.c === analitico.minimo ? "text-emerald-700" : ""}>{t.c}{t.c === analitico.minimo ? " ✓ mínimo" : ""}</b>,
            pct(t.ocupacion), min(t.esperaMin), min(t.p90Min), pct(t.nivelServicio), `S/ ${(t.c * p.costoVentanilla).toFixed(1)}`,
          ])} />
        </Seccion>
      )}

      {tab === "backtest" && (
        <Seccion titulo="Validación con los últimos 14 días" descripcion="Simula cada día con sus llegadas y ventanillas reales y compara con lo observado." acciones={<Button onClick={backtest}>Ejecutar</Button>}>
          {bt && (
            <>
              <p className="mb-3 text-sm">Error medio: <b>{pct(bt.reduce((a, d) => a + d.error, 0) / Math.max(1, bt.length))}</b> · días con error ≤ 15 %: {bt.filter((d) => d.error <= 0.15).length}/{bt.length}{bt.reduce((a, d) => a + d.error, 0) / Math.max(1, bt.length) > 0.25 ? " · ⚠ el modelo no reproduce bien tu operación" : ""}</p>
              <Tabla columnas={["Día", "Espera observada", "Simulada", "P90 observado", "P90 simulado", "Error"]} filas={bt.map((d) => [d.fecha, min(d.obs), min(d.simu), min(d.obsP90), min(d.simP90), pct(d.error)])} />
            </>
          )}
        </Seccion>
      )}

      {tab === "guardados" && (
        <Seccion titulo="Escenarios guardados">
          <Tabla columnas={["Nombre", "Semilla", "% SLA", ""]} vacio="Aún no guardaste escenarios." filas={(guardados.datos ?? []).map((g) => [
            g.nombre, g.semilla, g.resultados?.pctSla != null ? pct(g.resultados.pctSla) : "—",
            <div key="a" className="flex gap-1">
              <Button size="xs" variant="outline" onClick={async () => { if (await accion(() => api(`/api/v1/simulador/escenarios/${g.id}/duplicar`, { method: "POST" }), "Duplicado")) void guardados.recargar(); }}>Duplicar</Button>
              <Button size="xs" variant="ghost" className="text-rose-700" onClick={async () => { if (await accion(() => api(`/api/v1/simulador/escenarios/${g.id}`, { method: "DELETE" }), "Eliminado")) void guardados.recargar(); }}>Eliminar</Button>
            </div>,
          ])} />
        </Seccion>
      )}
    </div>
  );
}
