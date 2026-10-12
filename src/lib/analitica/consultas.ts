import { prisma } from "@/lib/db";
import { ErrorNegocio } from "@/lib/errores";
import { fechaADate } from "@/lib/fechas";
import { cumplimientoSla } from "@/lib/analitica/sla";
import { media } from "@/lib/prediccion/cuantiles";

/**
 * M7 · Consultas de analítica (§6.1–6.3, §6.8). Percentiles con `percentile_cont` (tipo 7) por consulta directa;
 * la vista materializada `mv_turno_franja` se usa para conteos del mapa de calor de llegadas y la línea base de anomalías.
 */

const r1 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 10) / 10);

export async function percentiles(localId: number, desdeISO: string, hastaISO: string, colaId: number | null, agrupar: "cola" | "hora" | "dia") {
  const desde = fechaADate(desdeISO);
  const hasta = fechaADate(hastaISO);
  const local = await prisma.local.findUniqueOrThrow({ where: { id: localId }, select: { zonaHoraria: true } });
  const grupoSql =
    agrupar === "cola"
      ? "c.nombre"
      : agrupar === "hora"
        ? `lpad(EXTRACT(HOUR FROM ((t.emitido_at AT TIME ZONE 'UTC') AT TIME ZONE '${local.zonaHoraria.replace(/'/g, "")}'))::text, 2, '0') || ':00'`
        : "to_char(t.fecha, 'YYYY-MM-DD')";
  const rows = await prisma.$queryRawUnsafe<{ grupo: string; n: number; p50: number | null; p90: number | null; p95: number | null; a50: number | null; a90: number | null; a95: number | null }[]>(
    `SELECT ${grupoSql} AS grupo, COUNT(*)::int AS n,
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY LEAST(EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)), 28800)) / 60 AS p50,
            percentile_cont(0.9)  WITHIN GROUP (ORDER BY LEAST(EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)), 28800)) / 60 AS p90,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY LEAST(EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)), 28800)) / 60 AS p95,
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.finalizado_at - t.llamado_at))) FILTER (WHERE t.estado = 'ATENDIDO' AND t.finalizado_at IS NOT NULL) / 60 AS a50,
            percentile_cont(0.9)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.finalizado_at - t.llamado_at))) FILTER (WHERE t.estado = 'ATENDIDO' AND t.finalizado_at IS NOT NULL) / 60 AS a90,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.finalizado_at - t.llamado_at))) FILTER (WHERE t.estado = 'ATENDIDO' AND t.finalizado_at IS NOT NULL) / 60 AS a95
       FROM turno t JOIN cola c ON c.id = t.cola_id
      WHERE t.local_id = $1 AND t.fecha BETWEEN $2 AND $3 AND t.llamado_at IS NOT NULL AND t.llamado_at >= t.emitido_at
        AND ($4::int IS NULL OR t.cola_id = $4::int)
      GROUP BY 1 ORDER BY 1`,
    localId,
    desde,
    hasta,
    colaId,
  );
  return rows.map((r) => ({ grupo: r.grupo, n: r.n, espera: { p50: r1(r.p50), p90: r1(r.p90), p95: r1(r.p95) }, atencion: { p50: r1(r.a50), p90: r1(r.a90), p95: r1(r.a95) } }));
}

export type MetricaHeatmap = "llegadas" | "espera_p90" | "abandono";

/** §6.2 Mapa de calor día × hora (6:00–21:00). */
export async function heatmap(localId: number, desdeISO: string, hastaISO: string, colaId: number | null, metrica: MetricaHeatmap) {
  const desde = fechaADate(desdeISO);
  const hasta = fechaADate(hastaISO);
  const local = await prisma.local.findUniqueOrThrow({ where: { id: localId }, select: { zonaHoraria: true } });
  const zona = local.zonaHoraria;
  const rows = await prisma.$queryRaw<{ dow: number; hora: number; dias: number; llegadas: number; abandonos: number; p90: number | null; n: number }[]>`
    SELECT EXTRACT(DOW FROM t.fecha)::int AS dow,
           EXTRACT(HOUR FROM ((t.emitido_at AT TIME ZONE 'UTC') AT TIME ZONE ${zona}))::int AS hora,
           COUNT(DISTINCT t.fecha)::int AS dias,
           COUNT(*)::int AS llegadas,
           COUNT(*) FILTER (WHERE t.estado IN ('CANCELADO', 'NO_SE_PRESENTO'))::int AS abandonos,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at))) FILTER (WHERE t.llamado_at IS NOT NULL) / 60 AS p90,
           COUNT(*) FILTER (WHERE t.llamado_at IS NOT NULL)::int AS n
      FROM turno t
     WHERE t.local_id = ${localId}::int AND t.fecha BETWEEN ${desde}::date AND ${hasta}::date AND t.estado <> 'TRANSFERIDO'
       AND (${colaId}::int IS NULL OR t.cola_id = ${colaId}::int)
     GROUP BY 1, 2`;
  // Número de ocurrencias de cada día de la semana en el rango (para la media de llegadas)
  const ocurrencias = Array(7).fill(0);
  for (let d = desde.getTime(); d <= hasta.getTime(); d += 86400000) ocurrencias[new Date(d).getUTCDay()]++;
  const horas = Array.from({ length: 16 }, (_, i) => i + 6);
  const dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const matriz = [1, 2, 3, 4, 5, 6, 0].map((dow) => ({
    dow,
    dia: dias[dow],
    celdas: horas.map((h) => {
      const r = rows.find((x) => x.dow === dow && x.hora === h);
      const valor =
        !r ? 0
        : metrica === "llegadas" ? r1(r.llegadas / Math.max(1, ocurrencias[dow]))
        : metrica === "abandono" ? r1((r.abandonos / Math.max(1, r.llegadas)) * 100)
        : r1(r.p90);
      const n = !r ? 0 : metrica === "espera_p90" ? r.n : r.llegadas;
      return { hora: h, valor: valor ?? 0, n, confiable: n >= 5 };
    }),
  }));
  return { metrica, horas, matriz };
}

/** §6.3 Estado actual del SLA por cola (ventana móvil) con presupuesto de error. */
export async function estadoSla(localId: number, ahora = new Date()) {
  const colas = await prisma.cola.findMany({ where: { localId, activa: true }, include: { sla: true }, orderBy: { orden: "asc" } });
  const salida = [];
  for (const c of colas) {
    if (!c.sla || !c.sla.activo) {
      salida.push({ colaId: c.id, cola: c.nombre, configurado: false as const });
      continue;
    }
    const desde = new Date(ahora.getTime() - c.sla.ventanaMin * 60000);
    const turnos = await prisma.turno.findMany({
      where: { colaId: c.id, emitidoAt: { gte: desde }, estado: { not: "TRANSFERIDO" } },
      select: { estado: true, emitidoAt: true, llamadoAt: true, finalizadoAt: true },
    });
    const r = cumplimientoSla(
      turnos.map((t) => ({ estado: t.estado, llamado: !!t.llamadoAt, esperaSeg: ((t.llamadoAt ?? t.finalizadoAt ?? ahora).getTime() - t.emitidoAt.getTime()) / 1000 })),
      c.sla.esperaMaxMin,
      Number(c.sla.objetivoPct),
    );
    salida.push({
      colaId: c.id,
      cola: c.nombre,
      configurado: true as const,
      esperaMaxMin: c.sla.esperaMaxMin,
      objetivoPct: Number(c.sla.objetivoPct),
      ventanaMin: c.sla.ventanaMin,
      ...r,
      cumplimientoPct: r.cumplimiento === null ? null : Math.round(r.cumplimiento * 1000) / 10,
      presupuestoConsumido: Number.isFinite(r.presupuestoConsumido) ? Math.round(r.presupuestoConsumido * 100) / 100 : null,
    });
  }
  return salida;
}

/** Serie horaria del cumplimiento de SLA (últimos N días). */
export async function serieSla(localId: number, colaId: number, dias = 7) {
  const cola = await prisma.cola.findFirst({ where: { id: colaId, localId }, include: { sla: true, local: true } });
  if (!cola) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  if (!cola.sla) return [];
  const maxSeg = cola.sla.esperaMaxMin * 60;
  const rows = await prisma.$queryRaw<{ hora: Date; cumplen: number; total: number }[]>`
    SELECT date_trunc('hour', t.emitido_at) AS hora,
           COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)) <= ${maxSeg})::int AS cumplen,
           COUNT(*)::int AS total
      FROM turno t
     WHERE t.cola_id = ${colaId}::int AND t.llamado_at IS NOT NULL AND t.emitido_at >= ${new Date(Date.now() - dias * 86400000)}
     GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ hora: r.hora, cumplimientoPct: r.total ? Math.round((r.cumplen / r.total) * 1000) / 10 : null, n: r.total }));
}

/** §6.8 CSAT: promedio, % 4–5, distribución y estrellas por tramo de espera. */
export async function csat(localId: number, desdeISO: string, hastaISO: string) {
  const rows = await prisma.valoracion.findMany({
    where: { turno: { localId, fecha: { gte: fechaADate(desdeISO), lte: fechaADate(hastaISO) } } },
    include: { turno: { select: { emitidoAt: true, llamadoAt: true } } },
    orderBy: { createdAt: "desc" },
  });
  const tramos = [
    { etiqueta: "0–5 min", min: 0, max: 5 },
    { etiqueta: "5–10 min", min: 5, max: 10 },
    { etiqueta: "10–20 min", min: 10, max: 20 },
    { etiqueta: "20–30 min", min: 20, max: 30 },
    { etiqueta: "30+ min", min: 30, max: Infinity },
  ];
  const conEspera = rows.map((v) => ({ e: v.estrellas, min: v.turno.llamadoAt ? (v.turno.llamadoAt.getTime() - v.turno.emitidoAt.getTime()) / 60000 : null }));
  return {
    n: rows.length,
    promedio: rows.length ? r1(media(rows.map((r) => r.estrellas))) : null,
    pctSatisfechos: rows.length ? Math.round((rows.filter((r) => r.estrellas >= 4).length / rows.length) * 1000) / 10 : null,
    distribucion: [1, 2, 3, 4, 5].map((e) => ({ estrellas: e, cantidad: rows.filter((r) => r.estrellas === e).length })),
    porTramo: tramos.map((t) => {
      const xs = conEspera.filter((c) => c.min !== null && c.min >= t.min && c.min < t.max).map((c) => c.e);
      return { tramo: t.etiqueta, n: xs.length, promedio: xs.length ? r1(media(xs)) : null };
    }),
    // Comentarios sin datos personales (solo texto, sin vínculo al cliente)
    comentarios: rows.filter((r) => r.comentario).slice(0, 20).map((r) => ({ estrellas: r.estrellas, comentario: r.comentario, fecha: r.createdAt })),
  };
}

/** Resumen para la cabecera de Analítica. */
export async function resumen(localId: number, desdeISO: string, hastaISO: string, colaId: number | null) {
  const [pct, sla, satisf] = await Promise.all([percentiles(localId, desdeISO, hastaISO, colaId, "cola"), estadoSla(localId), csat(localId, desdeISO, hastaISO)]);
  const conteo = await prisma.turno.groupBy({
    by: ["estado"],
    where: { localId, fecha: { gte: fechaADate(desdeISO), lte: fechaADate(hastaISO) }, ...(colaId ? { colaId } : {}), estado: { not: "TRANSFERIDO" } },
    _count: true,
  });
  const total = conteo.reduce((a, c) => a + c._count, 0);
  const abandonos = conteo.filter((c) => c.estado === "CANCELADO" || c.estado === "NO_SE_PRESENTO").reduce((a, c) => a + c._count, 0);
  return {
    total,
    atendidos: conteo.find((c) => c.estado === "ATENDIDO")?._count ?? 0,
    tasaAbandono: total ? Math.round((abandonos / total) * 1000) / 10 : 0,
    porEstado: conteo.map((c) => ({ estado: c.estado, cantidad: c._count })),
    percentiles: pct,
    sla,
    csat: { promedio: satisf.promedio, pctSatisfechos: satisf.pctSatisfechos, n: satisf.n },
  };
}

/** Refresco concurrente de la vista materializada (job cada 5 min). */
export async function refrescarVista() {
  const t0 = Date.now();
  await prisma.$executeRawUnsafe("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_turno_franja");
  return { ms: Date.now() - t0 };
}
