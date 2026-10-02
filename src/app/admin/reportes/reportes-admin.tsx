"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Clock, Download, Loader2, QrCode, TimerReset, UserX } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, StatCard } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/fetcher";
import { ESTADO_CLASS, ESTADO_LABEL, fmtFecha, fmtHora } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReporteEspera } from "@/lib/turnos";

function isoLima(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const haceDias = (n: number) => isoLima(new Date(Date.now() - n * 86400000));

export function ReportesAdmin() {
  const [desde, setDesde] = useState(() => haceDias(13));
  const [hasta, setHasta] = useState(() => haceDias(0));
  const [data, setData] = useState<ReporteEspera | null>(null);
  const [cargando, setCargando] = useState(false);
  const [pagina, setPagina] = useState(0);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setData(await api<ReporteEspera>(`/api/v1/reportes/espera?desde=${desde}&hasta=${hasta}`));
      setPagina(0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);
  useEffect(() => void cargar(), [cargar]);

  const rapido = (dias: number) => {
    setDesde(haceDias(dias - 1));
    setHasta(haceDias(0));
  };

  const detalle = useMemo(() => (data ? [...data.detalle].reverse() : []), [data]);
  const porPagina = 25;
  const paginas = Math.ceil(detalle.length / porPagina);

  return (
    <div>
      <PageHeader title="Reportes de espera y atención" description="Indicadores por día, hora y cola para decidir cuánto personal poner por franja horaria (RF09).">
        <Button asChild variant="outline" size="sm">
          <a href={`/api/v1/reportes/espera?desde=${desde}&hasta=${hasta}&formato=csv`} download><Download className="size-4" /> Exportar CSV</a>
        </Button>
      </PageHeader>

      {/* Filtros */}
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="space-y-1">
          <Label htmlFor="desde" className="text-xs">Desde</Label>
          <Input id="desde" type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hasta" className="text-xs">Hasta</Label>
          <Input id="hasta" type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="flex gap-1.5">
          {[
            ["Hoy", 1],
            ["7 días", 7],
            ["14 días", 14],
            ["30 días", 30],
          ].map(([l, d]) => (
            <Button key={l} variant="outline" size="sm" onClick={() => rapido(Number(d))}>{l}</Button>
          ))}
        </div>
        {cargando && <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />}
      </div>

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Turnos" value={data.resumen.total.toLocaleString("es-PE")} hint={`${data.resumen.atendidos} atendidos`} icon={Activity} />
            <StatCard label="Espera promedio" value={`${data.resumen.esperaPromMin} min`} hint={`Máxima: ${data.resumen.esperaMaxMin} min`} icon={Clock} tone="good" />
            <StatCard label="Atención promedio" value={`${data.resumen.atencionPromMin} min`} hint="Por turno atendido" icon={TimerReset} />
            <StatCard label="Abandono" value={`${data.resumen.tasaAbandono}%`} hint={`${data.resumen.noPresentados} no se presentaron · ${data.resumen.cancelados} cancelados`} icon={UserX} tone={data.resumen.tasaAbandono > 5 ? "bad" : "good"} />
            <StatCard label="Por QR" value={`${data.resumen.pctQR}%`} hint="Meta ≥ 60 % al mes 2" icon={QrCode} tone={data.resumen.pctQR >= 60 ? "good" : "warn"} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border bg-card p-5 shadow-sm">
              <h2 className="font-semibold">Turnos y abandonos por día</h2>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.porDia} margin={{ left: -20, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="fecha" tickFormatter={fmtFecha} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip labelFormatter={(l) => fmtFecha(String(l))} />
                    <Legend />
                    <Area type="monotone" dataKey="turnos" name="Turnos" stroke="var(--chart-1)" fill="url(#gT)" strokeWidth={2} />
                    <Area type="monotone" dataKey="abandonos" name="Abandonos" stroke="var(--chart-4)" fill="transparent" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-2xl border bg-card p-5 shadow-sm">
              <h2 className="font-semibold">Espera promedio por día (min)</h2>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.porDia} margin={{ left: -20, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="fecha" tickFormatter={fmtFecha} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip labelFormatter={(l) => fmtFecha(String(l))} />
                    <Line type="monotone" dataKey="esperaPromMin" name="Espera prom. (min)" stroke="var(--chart-3)" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-2xl border bg-card p-5 shadow-sm">
              <h2 className="font-semibold">Demanda por hora del día</h2>
              <p className="text-xs text-muted-foreground">Llegadas acumuladas en el periodo y espera promedio por franja.</p>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.porHora} margin={{ left: -20, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} interval={1} />
                    <YAxis yAxisId="l" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="l" dataKey="turnos" name="Turnos" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                    <Line yAxisId="r" type="monotone" dataKey="esperaPromMin" name="Espera (min)" stroke="var(--chart-3)" strokeWidth={2} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-2xl border bg-card p-5 shadow-sm">
              <h2 className="font-semibold">Por cola</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cola</TableHead>
                    <TableHead className="text-right">Turnos</TableHead>
                    <TableHead className="text-right">Espera</TableHead>
                    <TableHead className="text-right">Atención</TableHead>
                    <TableHead className="text-right">Abandono</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.porCola.map((c) => (
                    <TableRow key={c.prefijo}>
                      <TableCell><span className="mr-2 inline-flex size-6 items-center justify-center rounded-md bg-teal-600 font-mono text-xs font-bold text-white">{c.prefijo}</span>{c.cola}</TableCell>
                      <TableCell className="text-right tabular">{c.turnos}</TableCell>
                      <TableCell className="text-right tabular">{c.esperaPromMin} min</TableCell>
                      <TableCell className="text-right tabular">{c.atencionPromMin} min</TableCell>
                      <TableCell className={cn("text-right tabular", c.tasaAbandono > 5 && "text-rose-600")}>{c.tasaAbandono}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </div>

          {/* Detalle */}
          <section className="mt-6 rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-semibold">Detalle de turnos</h2>
                <p className="text-xs text-muted-foreground">{detalle.length.toLocaleString("es-PE")} registros · exporta el CSV para el análisis completo</p>
              </div>
              {paginas > 1 && (
                <div className="flex items-center gap-2 text-sm">
                  <Button variant="outline" size="sm" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
                  <span className="tabular text-muted-foreground">{pagina + 1} / {paginas}</span>
                  <Button variant="outline" size="sm" disabled={pagina >= paginas - 1} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button>
                </div>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="hidden md:table-cell">Cola</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="hidden sm:table-cell">Canal</TableHead>
                  <TableHead className="hidden lg:table-cell">Ventanilla</TableHead>
                  <TableHead className="text-right">Emitido</TableHead>
                  <TableHead className="text-right">Espera</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Atención</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detalle.slice(pagina * porPagina, (pagina + 1) * porPagina).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-muted-foreground">{fmtFecha(d.fecha)}</TableCell>
                    <TableCell className="font-mono font-semibold">{d.codigo}</TableCell>
                    <TableCell className="hidden md:table-cell">{d.cola}</TableCell>
                    <TableCell><Badge className={cn("border", ESTADO_CLASS[d.estado])}>{ESTADO_LABEL[d.estado]}</Badge></TableCell>
                    <TableCell className="hidden sm:table-cell">{d.canal}</TableCell>
                    <TableCell className="hidden lg:table-cell">{d.ventanilla || "—"}</TableCell>
                    <TableCell className="text-right tabular">{fmtHora(d.emitidoAt)}</TableCell>
                    <TableCell className="text-right tabular">{d.esperaMin !== "" ? `${d.esperaMin} min` : "—"}</TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular">{d.atencionMin !== "" ? `${d.atencionMin} min` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      )}
    </div>
  );
}
