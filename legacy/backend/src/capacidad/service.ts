import { prisma } from "@backend/db";
import { ErrorNegocio } from "@backend/errores";
import { fechaADate, fechaLocalISO, sumarDiasISO } from "@backend/fechas";
import { ajustarLogNormal } from "@backend/capacidad/des";
import { cuantil, media, mediana } from "@backend/prediccion/cuantiles";
import type { Prisma } from "@backend/generated/prisma/client";

/** M8 · Calibración desde el histórico, datos para backtest y escenarios guardados (§6.4–6.5, §7). */

const hhmm = (franja: number) => `${String(Math.floor(franja / 2)).padStart(2, "0")}:${franja % 2 ? "30" : "00"}`;

export async function calibracion(localId: number, colaId: number, dias = 28, tipoDia: "laborable" | "sabado" | "todos" = "laborable") {
  const cola = await prisma.cola.findFirst({ where: { id: colaId, localId }, include: { local: { include: { horarios: { where: { activo: true } } } } } });
  if (!cola) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  const zona = cola.local.zonaHoraria;
  const hasta = fechaLocalISO(zona);
  const desde = sumarDiasISO(hasta, -dias);
  const filtroDow = tipoDia === "laborable" ? [1, 2, 3, 4, 5] : tipoDia === "sabado" ? [6] : [0, 1, 2, 3, 4, 5, 6];
  const franjas = await prisma.$queryRaw<{ franja: number; dias: number; llegadas: number }[]>`
    SELECT (EXTRACT(HOUR FROM ((t.emitido_at AT TIME ZONE 'UTC') AT TIME ZONE ${zona})) * 2
            + FLOOR(EXTRACT(MINUTE FROM ((t.emitido_at AT TIME ZONE 'UTC') AT TIME ZONE ${zona})) / 30))::int AS franja,
           COUNT(DISTINCT t.fecha)::int AS dias, COUNT(*)::int AS llegadas
      FROM turno t
     WHERE t.cola_id = ${colaId}::int AND t.fecha >= ${fechaADate(desde)}::date AND t.fecha < ${fechaADate(hasta)}::date
       AND EXTRACT(DOW FROM t.fecha)::int = ANY(${filtroDow}::int[]) AND t.transferido_de_turno_id IS NULL
     GROUP BY 1 ORDER BY 1`;
  const nDias = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(DISTINCT fecha)::int AS n FROM turno WHERE cola_id = ${colaId}::int AND fecha >= ${fechaADate(desde)}::date AND fecha < ${fechaADate(hasta)}::date
       AND EXTRACT(DOW FROM fecha)::int = ANY(${filtroDow}::int[])`;
  const totalDias = Math.max(1, nDias[0]?.n ?? 0);
  const servicios = await prisma.turno.findMany({
    where: { colaId, estado: "ATENDIDO", fecha: { gte: fechaADate(desde) }, llamadoAt: { not: null }, finalizadoAt: { not: null } },
    select: { llamadoAt: true, finalizadoAt: true },
  });
  const srv = servicios.map((s) => (s.finalizadoAt!.getTime() - s.llamadoAt!.getTime()) / 60000).filter((x) => x >= 0.5 && x <= 60);
  if (srv.length < 20 || !franjas.length) throw new ErrorNegocio("M8_SIN_DATOS", "No hay suficiente histórico para calibrar (mínimo 20 atenciones)", 409);
  const ln = ajustarLogNormal(srv);
  const estados = await prisma.turno.groupBy({ by: ["estado"], where: { colaId, fecha: { gte: fechaADate(desde) } }, _count: true });
  const total = estados.reduce((a, e) => a + e._count, 0);
  const ns = estados.find((e) => e.estado === "NO_SE_PRESENTO")?._count ?? 0;
  const cancelados = await prisma.turno.findMany({ where: { colaId, estado: "CANCELADO", fecha: { gte: fechaADate(desde) }, finalizadoAt: { not: null } }, select: { emitidoAt: true, finalizadoAt: true } });
  const paciencia = cancelados.length >= 10 ? media(cancelados.map((c) => (c.finalizadoAt!.getTime() - c.emitidoAt.getTime()) / 60000)) : null;
  // c(t): mediana de ventanillas distintas que llamaron en cada franja por día
  const cRows = await prisma.$queryRaw<{ franja: number; fecha: Date; c: number }[]>`
    SELECT (EXTRACT(HOUR FROM ((t.llamado_at AT TIME ZONE 'UTC') AT TIME ZONE ${zona})) * 2
            + FLOOR(EXTRACT(MINUTE FROM ((t.llamado_at AT TIME ZONE 'UTC') AT TIME ZONE ${zona})) / 30))::int AS franja,
           t.fecha, COUNT(DISTINCT t.ventanilla_id)::int AS c
      FROM turno t WHERE t.cola_id = ${colaId}::int AND t.fecha >= ${fechaADate(desde)}::date AND t.llamado_at IS NOT NULL
     GROUP BY 1, 2`;
  const cPorFranja = new Map<number, number[]>();
  for (const r of cRows) cPorFranja.set(r.franja, [...(cPorFranja.get(r.franja) ?? []), r.c]);
  const primera = franjas[0].franja;
  const ultima = franjas[franjas.length - 1].franja;
  const lambdaPorHora = franjas.map((f) => ({ desde: hhmm(f.franja), valor: Math.round((f.llegadas / totalDias) * 2 * 10) / 10 }));
  const ventanillas = [...cPorFranja.entries()].sort((a, b) => a[0] - b[0]).map(([f, xs]) => ({ desde: hhmm(f), c: Math.max(1, Math.round(mediana(xs))) }));
  const n = srv.length;
  return {
    colaId,
    dias,
    tipoDia,
    confianza: n >= 300 ? "alta" : n >= 100 ? "media" : "baja",
    n,
    parametros: {
      version: 1 as const,
      modo: "DIA" as const,
      horario: { apertura: hhmm(primera), cierre: hhmm(ultima + 1) },
      lambdaPorHora,
      servicio: { tipo: "LOGNORMAL" as const, mediaMin: Math.round(ln.media * 100) / 100, cv: Math.round(ln.cv * 100) / 100, muestras: srv.slice(0, 2000) },
      ventanillas: ventanillas.length ? ventanillas : [{ desde: hhmm(primera), c: 1 }],
      pacienciaMin: paciencia ? { tipo: "EXPONENCIAL" as const, media: Math.round(paciencia) } : null,
      noShow: total ? { p: Math.round((ns / total) * 1000) / 1000, minutos: 3 } : null,
    },
    servicio: { media: Math.round(media(srv) * 100) / 100, mediana: Math.round(mediana(srv) * 100) / 100, p90: Math.round(cuantil(srv, 0.9) * 100) / 100, logNormal: { mu: ln.mu, sigma: ln.sigma } },
    avisos: paciencia ? ["La paciencia se estima con la espera de quienes cancelaron: tiende a subestimarse."] : [],
  };
}

/** Datos reales por día (λ(t), c(t), espera media y P90 observadas) para que el navegador simule y compare. */
export async function datosBacktest(localId: number, colaId: number, dias = 14) {
  const cola = await prisma.cola.findFirst({ where: { id: colaId, localId }, include: { local: true } });
  if (!cola) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  const zona = cola.local.zonaHoraria;
  const hasta = fechaLocalISO(zona);
  const desde = sumarDiasISO(hasta, -dias);
  const turnos = await prisma.turno.findMany({
    where: { colaId, fecha: { gte: fechaADate(desde), lt: fechaADate(hasta) }, transferidoDeTurnoId: null },
    select: { fecha: true, emitidoAt: true, llamadoAt: true, ventanillaId: true },
  });
  const porDia = new Map<string, typeof turnos>();
  for (const t of turnos) {
    const k = t.fecha.toISOString().slice(0, 10);
    porDia.set(k, [...(porDia.get(k) ?? []), t]);
  }
  const franjaDe = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
    return Number(p.find((x) => x.type === "hour")?.value) * 2 + Math.floor(Number(p.find((x) => x.type === "minute")?.value) / 30);
  };
  return [...porDia.entries()]
    .sort()
    .filter(([, ts]) => ts.length >= 10)
    .map(([fecha, ts]) => {
      const lleg = new Map<number, number>();
      const vent = new Map<number, Set<number>>();
      for (const t of ts) {
        const f = franjaDe(t.emitidoAt);
        lleg.set(f, (lleg.get(f) ?? 0) + 1);
        if (t.llamadoAt && t.ventanillaId) {
          const g = franjaDe(t.llamadoAt);
          vent.set(g, (vent.get(g) ?? new Set()).add(t.ventanillaId));
        }
      }
      const esperas = ts.filter((t) => t.llamadoAt).map((t) => (t.llamadoAt!.getTime() - t.emitidoAt.getTime()) / 60000);
      const fr = [...lleg.keys()].sort((a, b) => a - b);
      return {
        fecha,
        apertura: hhmm(fr[0]),
        cierre: hhmm(fr[fr.length - 1] + 1),
        lambdaPorHora: fr.map((f) => ({ desde: hhmm(f), valor: (lleg.get(f) ?? 0) * 2 })),
        ventanillas: [...vent.entries()].sort((a, b) => a[0] - b[0]).map(([f, s]) => ({ desde: hhmm(f), c: s.size })),
        observado: { esperaMedia: media(esperas), esperaP90: cuantil(esperas, 0.9), n: esperas.length },
      };
    });
}

// ---------------------------------------------------------------------------
// Escenarios guardados
// ---------------------------------------------------------------------------
export async function listarEscenarios(localId: number) {
  return prisma.escenarioSimulacion.findMany({ where: { localId }, orderBy: { createdAt: "desc" }, select: { id: true, nombre: true, colaId: true, semilla: true, createdAt: true, resultados: true } });
}

export async function obtenerEscenario(localId: number, id: number) {
  const e = await prisma.escenarioSimulacion.findFirst({ where: { id, localId } });
  if (!e) throw new ErrorNegocio("NO_ENCONTRADO", "El escenario no existe", 404);
  return e;
}

export async function crearEscenario(localId: number, usuarioId: number, d: { nombre: string; colaId?: number | null; parametros: unknown; resultados?: unknown; semilla: number }) {
  if ((await prisma.escenarioSimulacion.count({ where: { localId } })) >= 20) throw new ErrorNegocio("M8_LIMITE_ESCENARIOS", "Máximo 20 escenarios por local", 402);
  if (JSON.stringify(d.parametros).length > 20_000) throw new ErrorNegocio("M8_PARAMETROS_INVALIDOS", "Parámetros demasiado grandes", 422);
  if (d.colaId && !(await prisma.cola.findFirst({ where: { id: d.colaId, localId } }))) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  return prisma.escenarioSimulacion.create({ data: { localId, nombre: d.nombre, colaId: d.colaId ?? null, parametros: d.parametros as Prisma.InputJsonValue, resultados: (d.resultados ?? undefined) as Prisma.InputJsonValue | undefined, semilla: d.semilla, createdBy: usuarioId } });
}

export async function editarEscenario(localId: number, id: number, d: { nombre?: string; resultados?: unknown }) {
  await obtenerEscenario(localId, id);
  return prisma.escenarioSimulacion.update({ where: { id }, data: { ...(d.nombre ? { nombre: d.nombre } : {}), ...(d.resultados !== undefined ? { resultados: d.resultados as Prisma.InputJsonValue } : {}) } });
}

export async function eliminarEscenario(localId: number, id: number) {
  await obtenerEscenario(localId, id);
  await prisma.escenarioSimulacion.delete({ where: { id } });
}

export async function duplicarEscenario(localId: number, id: number, usuarioId: number) {
  const e = await obtenerEscenario(localId, id);
  return crearEscenario(localId, usuarioId, { nombre: `${e.nombre} (copia)`.slice(0, 80), colaId: e.colaId, parametros: e.parametros, resultados: e.resultados, semilla: e.semilla });
}
