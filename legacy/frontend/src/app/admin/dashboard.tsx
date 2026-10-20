"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ArrowUpRight, Check, Clock, ExternalLink, LayoutDashboard, Monitor, QrCode, Timer, Users, UserX } from "lucide-react";
import { PageHeader, StatCard } from "@/components/app/page-header";
import { EnVivo, Numero } from "@/components/app/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/fetcher";
import { ESTADO_CLASS, ESTADO_LABEL, fmtDuracion, fmtFecha, fmtFechaLarga, fmtHora } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReporteEspera, SnapshotLocal } from "@backend/turnos";
import { useRealtime } from "@/hooks/use-realtime";

const COLORES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "#64748b"];

/** Tooltip de los gráficos con el estilo del sistema (en lugar del recuadro por defecto de recharts). */
const TOOLTIP = {
  contentStyle: { borderRadius: 12, border: "1px solid var(--border)", boxShadow: "var(--shadow-lifted)", fontSize: 12, padding: "8px 12px" },
  cursor: { fill: "var(--muted)", opacity: 0.6 },
} as const;

export function Dashboard({ inicial, semana }: { inicial: SnapshotLocal; semana: ReporteEspera }) {
  const [snap, setSnap] = useState(inicial);

  const refrescar = useCallback(async () => {
    try {
      setSnap(await api<SnapshotLocal>(`/api/v1/panel/estado?slug=${inicial.local.slug}`));
    } catch {
      /* ignorar */
    }
  }, [inicial.local.slug]);

  const conexion = useRealtime(inicial.local.slug, () => void refrescar());
  useEffect(() => {
    const id = setInterval(refrescar, 30000);
    return () => clearInterval(id);
  }, [refrescar]);

  const s = snap.stats;
  const porEstado = semana.porEstado.filter((e) => e.cantidad > 0);
  const horasHoy = semana.porHora;

  return (
    <div>
      <PageHeader title={`Hola, ${snap.local.nombreComercial}`} description={`Resumen de hoy, ${fmtFechaLarga(snap.fecha)}.`}>
        <EnVivo estado={conexion} />
        <Button asChild variant="outline" size="sm">
          <Link href={`/l/${snap.local.slug}/tv`} target="_blank"><Monitor className="size-4" /> Pantalla TV <ExternalLink className="size-3" /></Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/panel"><LayoutDashboard className="size-4" /> Panel de ventanilla</Link>
        </Button>
      </PageHeader>

      {/* KPIs del día */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard indice={0} label="Turnos hoy" value={s.total} hint={`${s.pctQR}% tomados por QR`} icon={Activity} />
        <StatCard indice={1} label="En espera ahora" value={s.enEspera} hint={`${s.llamados} en atención`} icon={Users} tone="warn" />
        <StatCard indice={2} label="Espera promedio" value={s.esperaPromedioMin} sufijo=" min" hint={`Atención: ${s.atencionPromedioMin} min por turno`} icon={Clock} tone="good" />
        <StatCard indice={3} label="Tasa de abandono" value={s.tasaAbandono} sufijo="%" hint={`${s.noPresentados} no se presentaron · ${s.cancelados} cancelados`} icon={UserX} tone={s.tasaAbandono > 5 ? "bad" : "good"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Estado de colas en vivo */}
        <section className="rounded-2xl border bg-card p-5 shadow-soft lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold tracking-tight">Colas en vivo</h2>
            <Link href="/admin/colas" className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline">Administrar</Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {snap.colas.map((c) => (
              <div key={c.id} className="rounded-2xl border bg-gradient-to-b from-muted/30 to-transparent p-4">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg font-mono text-sm font-bold text-white shadow-sm" style={{ background: snap.local.colorPrimario }}>{c.prefijo}</span>
                  <p className="truncate font-medium">{c.nombre}</p>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-3xl font-semibold tracking-tight"><Numero valor={c.enEspera} /></p>
                    <p className="text-xs text-muted-foreground">en espera</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{c.enEspera ? `~ ${fmtDuracion(c.tiempoEstimadoSeg)}` : "Sin espera"}</p>
                    <p className="text-xs text-muted-foreground">{c.ventanillas.length} ventanilla{c.ventanillas.length === 1 ? "" : "s"}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1">
                  <AnimatePresence initial={false}>
                    {c.llamados.map((l) => (
                      <motion.p
                        key={l.id}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                        className="overflow-hidden"
                      >
                        <span className="flex items-center justify-between rounded-lg bg-teal-50 px-2 py-1 text-xs text-teal-900">
                          <span className="font-mono font-semibold">{l.codigo}</span>
                          <span>{l.ventanilla}</span>
                        </span>
                      </motion.p>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>

          {/* Últimos llamados: el nuevo entra arriba y empuja al resto */}
          <h3 className="mt-6 text-sm font-semibold text-muted-foreground">Últimos llamados</h3>
          <ul className="mt-2 text-sm">
            <AnimatePresence initial={false} mode="popLayout">
              {snap.ultimosLlamados.slice(0, 6).map((l) => (
                <motion.li
                  key={l.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                  className="grid grid-cols-[4.5rem_1fr_auto_auto] items-center gap-3 border-b py-2 last:border-b-0"
                >
                  <span className="font-mono font-semibold">{l.codigo}</span>
                  <span className="truncate text-muted-foreground">{l.ventanilla}</span>
                  <Badge className={cn("border", ESTADO_CLASS[l.estado])}>{ESTADO_LABEL[l.estado]}</Badge>
                  <span className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">{fmtHora(l.llamadoAt)}</span>
                </motion.li>
              ))}
            </AnimatePresence>
            {snap.ultimosLlamados.length === 0 && <li className="py-6 text-center text-muted-foreground">Aún no hay llamados hoy.</li>}
          </ul>
        </section>

        {/* Estados (7 días) */}
        <section className="rounded-2xl border bg-card p-5 shadow-soft">
          <h2 className="font-semibold tracking-tight">Resultado de turnos</h2>
          <p className="text-xs text-muted-foreground">Últimos 7 días · {semana.resumen.total} turnos</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={porEstado} dataKey="cantidad" nameKey="estado" innerRadius={56} outerRadius={82} paddingAngle={2} cornerRadius={4} stroke="none" animationDuration={700} animationEasing="ease-out">
                  {porEstado.map((e, i) => (
                    <Cell key={e.estado} fill={e.estado === "ATENDIDO" ? "var(--chart-1)" : e.estado === "NO_SE_PRESENTO" ? "var(--chart-4)" : e.estado === "CANCELADO" ? "#94a3b8" : COLORES[(i + 1) % COLORES.length]} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP} formatter={(v, n) => [v as number, ESTADO_LABEL[n as keyof typeof ESTADO_LABEL] ?? n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="space-y-1.5 text-sm">
            {porEstado.map((e) => (
              <li key={e.estado} className="flex items-center justify-between">
                <span className="flex items-center gap-2"><span className={cn("size-2.5 rounded-full", e.estado === "ATENDIDO" ? "bg-teal-600" : e.estado === "NO_SE_PRESENTO" ? "bg-rose-500" : e.estado === "CANCELADO" ? "bg-slate-400" : "bg-amber-400")} /> {ESTADO_LABEL[e.estado]}</span>
                <span className="font-medium tabular-nums">{e.cantidad} <span className="text-xs text-muted-foreground">({semana.resumen.total ? Math.round((e.cantidad / semana.resumen.total) * 100) : 0}%)</span></span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold tracking-tight">Turnos por día</h2>
              <p className="text-xs text-muted-foreground">Últimos 7 días</p>
            </div>
            <Link href="/admin/reportes" className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline">Ver reportes</Link>
          </div>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={semana.porDia} margin={{ left: -20, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gTurnos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="fecha" tickFormatter={fmtFecha} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip {...TOOLTIP} cursor={{ stroke: "var(--border)" }} labelFormatter={(l) => fmtFecha(String(l))} />
                <Area type="monotone" dataKey="turnos" name="Turnos" stroke="var(--chart-1)" fill="url(#gTurnos)" strokeWidth={2} animationDuration={800} animationEasing="ease-out" activeDot={{ r: 4, strokeWidth: 0 }} />
                <Area type="monotone" dataKey="atendidos" name="Atendidos" stroke="var(--chart-3)" fill="transparent" strokeWidth={2} animationDuration={800} animationEasing="ease-out" activeDot={{ r: 4, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold tracking-tight">Demanda por hora</h2>
              <p className="text-xs text-muted-foreground">Llegadas acumuladas (7 días) · para planificar personal por franja</p>
            </div>
            <Timer className="size-4 text-muted-foreground" />
          </div>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={horasHoy} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} interval={1} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip {...TOOLTIP} />
                <Bar dataKey="turnos" name="Turnos" fill="var(--chart-2)" radius={[6, 6, 0, 0]} animationDuration={700} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Accesos rápidos */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { href: "/admin/pantalla", icon: QrCode, t: "Imprimir QR del local", d: "Descarga el afiche con el código QR para la sala." },
          { href: "/admin/notificaciones", icon: Check, t: "Avisos WhatsApp", d: "Revisa entregas, lecturas y fallos de los mensajes." },
          { href: "/admin/usuarios", icon: Users, t: "Operadores", d: "Crea cuentas para recepción y consultorios." },
        ].map((a) => (
          <Link key={a.href} href={a.href} className="lift group relative rounded-2xl border bg-card p-5 shadow-soft hover:border-teal-500/50">
            <span className="flex size-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-teal-100 transition-colors duration-200 group-hover:bg-teal-600 group-hover:text-white group-hover:ring-teal-600">
              <a.icon className="size-5" />
            </span>
            <ArrowUpRight className="absolute right-5 top-5 size-4 text-muted-foreground/60 transition-[translate,color] duration-200 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-teal-700" />
            <p className="mt-4 font-semibold">{a.t}</p>
            <p className="mt-1 text-sm text-muted-foreground">{a.d}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
