"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/app/page-header";
import { Estado, Kpi, Seccion, Tabla, accion, fmtFechaHora, useDatos } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

interface Metricas {
  activo: { tipo: string; version: number; entrenadoAt: string; deriva: boolean } | null;
  modelos: { tipo: string; activo: boolean; n: number; maeMin: number | null; medaeMin: number | null; acierto5: number | null; sesgoMin: number | null; cobertura: number | null; anchoMin: number | null; importancia: { variable: string; importancia: number }[] | null; entrenadoAt: string }[];
  produccion: { n: number; maeMin: number; cobertura: number } | null;
  serie: { t: string; pred: number; lo: number; hi: number; real: number }[];
}
interface Config {
  modelo: string;
  alfaEma: number;
  nivelConfianza: number;
  diasEntrenamiento: number;
}

const NOMBRES: Record<string, string> = { BASELINE: "Base (RN02)", EMA: "Media móvil exponencial", ESTACIONAL: "Estacional (día × franja)" };
const r1 = (x: number | null | undefined) => (x == null ? "—" : (Math.round(x * 10) / 10).toString());
const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)} %`);

/** M2 · Precisión del modelo, comparación con la base, importancia de variables, configuración y reentrenamiento. */
export function Prediccion({ colas }: { colas: { id: number; nombre: string }[] }) {
  const [colaId, setColaId] = useState(colas[0]?.id ?? 0);
  const { datos, error, cargando, recargar } = useDatos<Metricas>(colaId ? `/api/v1/prediccion/metricas?colaId=${colaId}` : null, [colaId]);
  const cfgQ = useDatos<Config>("/api/v1/prediccion/config");
  const [cfg, setCfg] = useState<Config | null>(null);
  const [entrenando, setEntrenando] = useState(false);
  useEffect(() => setCfg(cfgQ.datos), [cfgQ.datos]);

  async function reentrenar() {
    setEntrenando(true);
    const r = await accion(() => api<{ elegido: string; maeAntesMin: number | null; maeDespuesMin: number }[]>("/api/v1/prediccion/reentrenar", { method: "POST", json: { colaId } }));
    setEntrenando(false);
    if (r?.[0]) {
      toast.success(`Modelo ${NOMBRES[r[0].elegido] ?? r[0].elegido}: MAE ${r1(r[0].maeAntesMin)} → ${r1(r[0].maeDespuesMin)} min`);
      void recargar();
    }
  }

  const activo = datos?.modelos.find((m) => m.activo);
  const base = datos?.modelos.find((m) => m.tipo === "BASELINE");
  const mejora = activo?.maeMin != null && base?.maeMin ? 1 - activo.maeMin / base.maeMin : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Predicción de espera" description="Rango de espera p. ej. “14–22 min”, evaluado sin fuga de datos y monitoreado en producción.">
        <NativeSelect aria-label="Cola" value={colaId} onChange={(e) => setColaId(Number(e.target.value))} className="w-48">
          {colas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </NativeSelect>
        <Button onClick={reentrenar} disabled={entrenando || !colaId}><RefreshCw className={entrenando ? "size-4 animate-spin" : "size-4"} /> Reentrenar ahora</Button>
      </PageHeader>

      <Estado cargando={cargando} error={error} vacio={!!datos && !datos.modelos.length} mensajeVacio="Aún no hay un modelo entrenado. Pulsa “Reentrenar ahora” (se usa el histórico de la cola); mientras tanto se usa la estimación inicial.">
        {datos && (
          <>
            {datos.activo?.deriva && (
              <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Se detectó deriva: el error en producción superó 1,3 × el de validación. Se volvió al modelo base hasta el próximo reentrenamiento.</p>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Kpi etiqueta="Modelo activo" valor={<span className="text-base">{activo ? NOMBRES[activo.tipo] : "—"}</span>} pista={datos.activo ? `v${datos.activo.version} · ${fmtFechaHora(datos.activo.entrenadoAt)}` : undefined} />
              <Kpi etiqueta="Error medio (MAE)" valor={`${r1(activo?.maeMin)} min`} pista={mejora != null ? `${Math.round(mejora * 100)} % mejor que la base` : undefined} tono={mejora != null && mejora > 0 ? "bien" : "default"} />
              <Kpi etiqueta="Aciertos ±5 min" valor={pct(activo?.acierto5)} />
              <Kpi etiqueta="Cobertura del rango" valor={pct(activo?.cobertura)} pista={cfg ? `objetivo ${cfg.nivelConfianza * 100} %` : undefined} />
              <Kpi etiqueta="En producción (7 d)" valor={datos.produccion ? `${r1(datos.produccion.maeMin)} min` : "—"} pista={datos.produccion ? `${datos.produccion.n} turnos · cobertura ${pct(datos.produccion.cobertura)}` : "sin predicciones aún"} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <Seccion titulo="Real vs. predicho" descripcion="Cada punto es un turno: línea = predicción, banda = rango mostrado al cliente.">
                {datos.serie.length ? (
                  <div className="h-64" role="img" aria-label="Gráfico de espera real frente a la predicha">
                    <ResponsiveContainer>
                      <ComposedChart data={datos.serie.map((s, i) => ({ ...s, i, banda: [s.lo, s.hi] }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="i" hide />
                        <YAxis unit=" min" width={50} fontSize={12} />
                        <Tooltip formatter={(v) => (Array.isArray(v) ? `${v[0]}–${v[1]} min` : `${v} min`)} />
                        <Area dataKey="banda" stroke="none" fill="#99f6e4" fillOpacity={0.5} name="Rango" />
                        <Line dataKey="pred" stroke="#0f766e" dot={false} strokeWidth={2} name="Predicho" />
                        <Line dataKey="real" stroke="#f59e0b" dot={{ r: 2 }} strokeWidth={0} name="Real" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : <p className="text-sm text-muted-foreground">Las predicciones se completan cuando los turnos son llamados.</p>}
              </Seccion>

              <Seccion titulo="Importancia de variables" descripcion="Cuánto empeora el error al desordenar cada variable (permutación).">
                {activo?.importancia?.length ? (
                  <div className="h-56">
                    <ResponsiveContainer>
                      <BarChart data={activo.importancia} layout="vertical" margin={{ left: 40 }}>
                        <XAxis type="number" unit=" %" fontSize={12} />
                        <YAxis type="category" dataKey="variable" width={140} fontSize={12} />
                        <Tooltip />
                        <Bar dataKey="importancia" fill="#0f766e" radius={4} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <p className="text-sm text-muted-foreground">Se calcula al reentrenar con suficientes datos.</p>}
              </Seccion>
            </div>

            <Seccion titulo="Comparación de modelos" descripcion="Validación cronológica (walk-forward) de los últimos 7 días.">
              <Tabla
                columnas={["Modelo", "Muestras", "MAE", "Mediana del error", "±5 min", "Sesgo", "Cobertura", "Ancho medio"]}
                filas={datos.modelos.map((m) => [
                  <span key="m">{NOMBRES[m.tipo]} {m.activo && <Badge className="ml-1 bg-teal-100 text-teal-800">activo</Badge>}</span>,
                  m.n,
                  `${r1(m.maeMin)} min`,
                  `${r1(m.medaeMin)} min`,
                  pct(m.acierto5),
                  `${r1(m.sesgoMin)} min`,
                  pct(m.cobertura),
                  `${r1(m.anchoMin)} min`,
                ])}
              />
            </Seccion>
          </>
        )}
      </Estado>

      {cfg && (
        <Seccion
          titulo="Configuración"
          acciones={<Button variant="outline" onClick={async () => { if (await accion(() => api("/api/v1/prediccion/config", { method: "PUT", json: cfg }), "Configuración guardada")) void cfgQ.recargar(); }}>Guardar</Button>}
        >
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <Label htmlFor="modo">Modelo</Label>
              <NativeSelect id="modo" value={cfg.modelo} onChange={(e) => setCfg({ ...cfg, modelo: e.target.value })}>
                <option value="AUTO">Automático (el de menor error)</option>
                {Object.entries(NOMBRES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="alfa">α de la EMA: {cfg.alfaEma.toFixed(2)}</Label>
              <input id="alfa" type="range" min={0.05} max={0.5} step={0.05} value={cfg.alfaEma} onChange={(e) => setCfg({ ...cfg, alfaEma: Number(e.target.value) })} className="mt-3 w-full accent-teal-700" />
            </div>
            <div>
              <Label htmlFor="nivel">Nivel de confianza</Label>
              <NativeSelect id="nivel" value={cfg.nivelConfianza} onChange={(e) => setCfg({ ...cfg, nivelConfianza: Number(e.target.value) })}>
                <option value={0.8}>80 %</option>
                <option value={0.9}>90 %</option>
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="dias">Días de entrenamiento</Label>
              <NativeSelect id="dias" value={cfg.diasEntrenamiento} onChange={(e) => setCfg({ ...cfg, diasEntrenamiento: Number(e.target.value) })}>
                {[30, 60, 90, 120].map((d) => <option key={d} value={d}>{d}</option>)}
              </NativeSelect>
            </div>
          </div>
        </Seccion>
      )}
    </div>
  );
}
