import { prisma } from "@/lib/db";
import { ErrorNegocio } from "@/lib/errores";
import { publicar } from "@/lib/realtime";
import { descifrar } from "@/lib/crypto";
import { enviarAviso } from "@/lib/notificaciones";
import { moduloActivo } from "@/lib/modulos";
import { contar, observar } from "@/lib/metricas";
import { log } from "@/lib/log";
import { fechaADate, fechaLocalISO, partesLocales, sumarDiasISO } from "@/lib/fechas";
import { cuantil, media } from "@/lib/prediccion/cuantiles";
import {
  actualizarPhi,
  actualizarServicio,
  elegibles,
  elegirModelo,
  entrenar,
  estadoInicial,
  estructural,
  hayDeriva,
  importanciaPermutacion,
  intervalo,
  predecir,
  type EstadoModelo,
  type MuestraTurno,
  type TipoModelo,
} from "@/lib/prediccion/modelos";
import type { Prisma } from "@/generated/prisma/client";

/** M2 · Casos de uso de predicción (docs/modulos/M2-prediccion-espera.md). Un modelo por cola, persistido. */

function franjaDe(d: Date, zona: string) {
  const p = partesLocales(zona, d);
  return { dow: p.diaSemana, franja: p.hora * 2 + Math.floor(p.minuto / 30) };
}

export async function leerConfig(localId: number) {
  const c = await prisma.configPrediccion.upsert({ where: { localId }, create: { localId }, update: {} });
  return { modelo: c.modelo, alfaEma: Number(c.alfaEma), nivelConfianza: Number(c.nivelConfianza), diasEntrenamiento: c.diasEntrenamiento };
}

// ---------------------------------------------------------------------------
// Caché del modelo activo por cola (30 s, se invalida al reentrenar)
// ---------------------------------------------------------------------------
const g = globalThis as unknown as { turnoyaModelos?: Map<number, { at: number; id: number | null; version: number; estado: EstadoModelo }> };
const cache = g.turnoyaModelos ?? new Map<number, { at: number; id: number | null; version: number; estado: EstadoModelo }>();
g.turnoyaModelos = cache;

async function modeloActivo(colaId: number) {
  const hit = cache.get(colaId);
  if (hit && Date.now() - hit.at < 30_000) return hit;
  const m = await prisma.modeloEntrenado.findFirst({ where: { colaId, activo: true }, orderBy: { id: "desc" } });
  let entrada;
  if (m) {
    entrada = { at: Date.now(), id: m.id, version: m.version, estado: m.parametros as unknown as EstadoModelo };
  } else {
    // Arranque en frío: BASELINE con el tiempo base de la cola y los últimos servicios reales
    const cola = await prisma.cola.findUnique({ where: { id: colaId }, select: { tiempoAtencionBase: true } });
    const e = estadoInicial("BASELINE", cola?.tiempoAtencionBase ?? 300);
    const ult = await prisma.turno.findMany({
      where: { colaId, estado: "ATENDIDO", llamadoAt: { not: null }, finalizadoAt: { not: null } },
      orderBy: { finalizadoAt: "desc" },
      take: 10,
      select: { llamadoAt: true, finalizadoAt: true },
    });
    for (const t of ult.reverse()) actualizarServicio(e, (t.finalizadoAt!.getTime() - t.llamadoAt!.getTime()) / 1000, 0, 0);
    entrada = { at: Date.now(), id: null, version: 0, estado: e };
  }
  cache.set(colaId, entrada);
  return entrada;
}

export function invalidarModelo(colaId?: number) {
  if (colaId === undefined) cache.clear();
  else cache.delete(colaId);
}

/** RN-M2-04: ventanillas operativas = de la cola con un llamado en los últimos 15 min o un turno LLAMADO ahora; mínimo 1. */
export async function ventanillasOperativas(colaId: number, ahora = new Date()) {
  const desde = new Date(ahora.getTime() - 15 * 60000);
  const rows = await prisma.turno.findMany({
    where: { colaId, ventanillaId: { not: null }, OR: [{ estado: "LLAMADO" }, { llamadoAt: { gte: desde } }] },
    select: { ventanillaId: true },
    distinct: ["ventanillaId"],
  });
  if (rows.length) return rows.length;
  // Sin actividad reciente (inicio del día): se asume que atienden las ventanillas activas asignadas a la cola
  const cola = await prisma.cola.findUnique({ where: { id: colaId }, select: { localId: true } });
  const activas = await prisma.ventanilla.count({ where: { localId: cola?.localId ?? 0, activa: true, colaId } });
  return Math.max(1, activas);
}

/** Predicción para alguien con `delante` personas antes (RF-M2-01). */
export async function predecirParaTurno(colaId: number, delante: number, ahora = new Date()) {
  const t0 = performance.now();
  const cola = await prisma.cola.findUnique({ where: { id: colaId }, select: { localId: true, local: { select: { zonaHoraria: true } } } });
  const m = await modeloActivo(colaId);
  const cfg = await leerConfig(cola?.localId ?? 0);
  const c = await ventanillasOperativas(colaId, ahora);
  const { dow, franja } = franjaDe(ahora, cola?.local.zonaHoraria ?? "America/Lima");
  const pred = predecir(m.estado, delante, c, dow, franja);
  const iv = intervalo(m.estado, pred, franja);
  observar("m2_prediccion_ms", performance.now() - t0);
  return {
    segundos: Math.round(pred),
    loSeg: Math.round(iv.lo),
    hiSeg: Math.round(iv.hi),
    confianza: cfg.nivelConfianza,
    modelo: m.estado.tipo,
    enfrio: m.id === null || m.estado.nServicios < 30,
    c,
  };
}

/** Registra la predicción mostrada al emitir (RF-M2-08). */
export async function registrarPrediccion(turnoId: number) {
  const t = await prisma.turno.findUnique({ where: { id: turnoId } });
  if (!t) return;
  const delante = t.delanteEmision ?? 0;
  const m = await modeloActivo(t.colaId);
  const p = await predecirParaTurno(t.colaId, delante, t.emitidoAt);
  await prisma.prediccionLog.upsert({
    where: { turnoId },
    create: { turnoId, colaId: t.colaId, tipo: m.estado.tipo, version: m.version, delante, c: p.c, predSeg: p.segundos, loSeg: p.loSeg, hiSeg: p.hiSeg },
    update: {},
  });
}

/** Al llamar: completa el valor real y aprende φ (ESTACIONAL). */
export async function completarReal(turnoId: number) {
  const t = await prisma.turno.findUnique({ where: { id: turnoId }, include: { local: { select: { zonaHoraria: true } } } });
  if (!t?.llamadoAt) return;
  const real = Math.round((t.llamadoAt.getTime() - t.emitidoAt.getTime()) / 1000);
  const logRow = await prisma.prediccionLog.findUnique({ where: { turnoId } });
  if (!logRow || logRow.realSeg != null) return;
  await prisma.prediccionLog.update({ where: { turnoId }, data: { realSeg: real } });
  const m = await modeloActivo(t.colaId);
  if (m.estado.tipo === "ESTACIONAL" && m.id) {
    const { dow, franja } = franjaDe(t.emitidoAt, t.local.zonaHoraria);
    actualizarPhi(m.estado, real, estructural(m.estado, logRow.delante, logRow.c, dow, franja), dow, franja);
    await prisma.modeloEntrenado.update({ where: { id: m.id }, data: { parametros: m.estado as unknown as Prisma.InputJsonValue } }).catch(() => {});
  }
}

/** Al cerrar una atención: actualización en línea del servicio (EMA, celdas). */
export async function aprenderServicio(turnoId: number) {
  const t = await prisma.turno.findUnique({ where: { id: turnoId }, include: { local: { select: { zonaHoraria: true } } } });
  if (!t?.llamadoAt || !t.finalizadoAt) return;
  const m = await modeloActivo(t.colaId);
  const { dow, franja } = franjaDe(t.llamadoAt, t.local.zonaHoraria);
  actualizarServicio(m.estado, (t.finalizadoAt.getTime() - t.llamadoAt.getTime()) / 1000, dow, franja);
  if (m.id) await prisma.modeloEntrenado.update({ where: { id: m.id }, data: { parametros: m.estado as unknown as Prisma.InputJsonValue } }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Entrenamiento (§6.6–6.8)
// ---------------------------------------------------------------------------

async function muestrasCola(colaId: number, desde: Date, zona: string): Promise<MuestraTurno[]> {
  const rows = await prisma.turno.findMany({
    where: { colaId, fecha: { gte: desde }, estado: { notIn: ["TRANSFERIDO"] } },
    select: { id: true, emitidoAt: true, llamadoAt: true, finalizadoAt: true, estado: true, delanteEmision: true, ventanillasActivasEmision: true },
    orderBy: { emitidoAt: "asc" },
  });
  return rows.map((r) => {
    const { dow, franja } = franjaDe(r.emitidoAt, zona);
    return {
      id: r.id,
      emitidoMs: r.emitidoAt.getTime(),
      llamadoMs: r.llamadoAt?.getTime() ?? null,
      finalizadoMs: r.finalizadoAt?.getTime() ?? null,
      atendido: r.estado === "ATENDIDO",
      delante: r.delanteEmision ?? 0,
      c: Math.max(1, r.ventanillasActivasEmision ?? 1),
      dow,
      franja,
    };
  });
}

export async function reentrenarCola(colaId: number, ahora = new Date()) {
  const t0 = performance.now();
  const cola = await prisma.cola.findUnique({ where: { id: colaId }, include: { local: true } });
  if (!cola) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  const cfg = await leerConfig(cola.localId);
  const desdeISO = sumarDiasISO(fechaLocalISO(cola.local.zonaHoraria, ahora), -cfg.diasEntrenamiento);
  const muestras = await muestrasCola(colaId, fechaADate(desdeISO), cola.local.zonaHoraria);
  const nServicios = muestras.filter((m) => m.atendido && m.llamadoMs && m.finalizadoMs).length;
  const primera = muestras[0]?.emitidoMs ?? ahora.getTime();
  const diasHistoria = (ahora.getTime() - primera) / 86400000;
  const permitidos = elegibles(nServicios, diasHistoria);

  const resultados: Partial<Record<TipoModelo, ReturnType<typeof entrenar>>> = {};
  for (const tipo of ["BASELINE", "EMA", "ESTACIONAL"] as TipoModelo[]) {
    resultados[tipo] = entrenar(tipo, muestras, { base: cola.tiempoAtencionBase, alfa: cfg.alfaEma, nivel: cfg.nivelConfianza, ahoraMs: ahora.getTime() });
  }
  const anterior = await prisma.modeloEntrenado.findFirst({ where: { colaId, activo: true }, orderBy: { id: "desc" } });
  const maes = Object.fromEntries(Object.entries(resultados).map(([k, v]) => [k, v!.metricas.n ? v!.metricas.mae : Infinity])) as Record<TipoModelo, number>;
  const forzado = cfg.modelo !== "AUTO" && permitidos.includes(cfg.modelo as TipoModelo) ? (cfg.modelo as TipoModelo) : null;
  const elegido = forzado ?? elegirModelo(maes, (anterior?.tipo as TipoModelo | undefined) ?? null, permitidos);

  const ultimaVersion = await prisma.modeloEntrenado.aggregate({ where: { colaId }, _max: { version: true } });
  const version = (ultimaVersion._max.version ?? 0) + 1;
  const filas: Prisma.ModeloEntrenadoCreateManyInput[] = [];
  for (const tipo of ["BASELINE", "EMA", "ESTACIONAL"] as TipoModelo[]) {
    const r = resultados[tipo]!;
    filas.push({
      localId: cola.localId,
      colaId,
      tipo,
      version,
      parametros: r.estado as unknown as Prisma.InputJsonValue,
      nMuestras: r.metricas.n,
      mae: r.metricas.n ? r.metricas.mae : null,
      medae: r.metricas.n ? r.metricas.medae : null,
      acierto5: r.metricas.n ? r.metricas.acierto5 : null,
      sesgo: r.metricas.n ? r.metricas.sesgo : null,
      cobertura: r.metricas.n ? r.metricas.cobertura : null,
      anchoMedio: r.metricas.n ? r.metricas.anchoMedio : null,
      importancia: (importanciaPermutacion(r.estado, r.pares) ?? undefined) as Prisma.InputJsonValue | undefined,
      activo: false,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.modeloEntrenado.updateMany({ where: { colaId, activo: true }, data: { activo: false } });
    await tx.modeloEntrenado.createMany({ data: filas });
    await tx.modeloEntrenado.updateMany({ where: { colaId, version, tipo: elegido }, data: { activo: true } });
  });
  invalidarModelo(colaId);
  const ms = Math.round(performance.now() - t0);
  observar("m2_reentrenar_ms", ms);
  const maeAntes = anterior?.mae ?? null;
  const maeDespues = resultados[elegido]!.metricas.mae;
  log.info("modelo reentrenado", { modulo: "M2", local_id: cola.localId, cola: colaId, elegido, n: nServicios, mae: Math.round(maeDespues), duracion_ms: ms });
  if (anterior?.tipo !== elegido) publicar({ tipo: "prediccion:modelo", localId: cola.localId, colaId, modelo: elegido, deriva: false });
  return { colaId, elegido, version, nServicios, permitidos, maeAntesMin: maeAntes != null ? maeAntes / 60 : null, maeDespuesMin: maeDespues / 60, duracionMs: ms };
}

export async function reentrenarLocal(localId: number, colaId?: number | null) {
  const colas = await prisma.cola.findMany({ where: { localId, activa: true, ...(colaId ? { id: colaId } : {}) }, select: { id: true } });
  const out = [];
  for (const c of colas) out.push(await reentrenarCola(c.id));
  return out;
}

/** Job nocturno: reentrena todas las colas de los locales con M2. */
export async function jobReentrenar() {
  const locales = await prisma.local.findMany({ where: { activo: true }, select: { id: true } });
  let colas = 0;
  for (const l of locales) {
    if (!(await moduloActivo(l.id, "M2"))) continue;
    colas += (await reentrenarLocal(l.id)).length;
  }
  return { colas };
}

/** RN-M2-05: deriva en producción ⇒ BASELINE hasta el próximo reentrenamiento + alerta (M7). */
export async function jobDeriva(ahora = new Date()) {
  const activos = await prisma.modeloEntrenado.findMany({ where: { activo: true, tipo: { not: "BASELINE" }, deriva: false } });
  let derivas = 0;
  for (const m of activos) {
    if (!(await moduloActivo(m.localId, "M2"))) continue;
    const logs = await prisma.prediccionLog.findMany({
      where: { colaId: m.colaId, realSeg: { not: null }, createdAt: { gte: new Date(ahora.getTime() - 7 * 86400000) } },
      select: { predSeg: true, realSeg: true },
    });
    const maeProd = media(logs.map((l) => Math.abs(l.predSeg - (l.realSeg ?? 0))));
    if (!hayDeriva(maeProd, m.mae ?? 0, logs.length)) continue;
    derivas++;
    contar("m2_deriva_total");
    await prisma.$transaction([
      prisma.modeloEntrenado.updateMany({ where: { colaId: m.colaId, activo: true }, data: { activo: false } }),
      prisma.modeloEntrenado.updateMany({ where: { colaId: m.colaId, version: m.version, tipo: "BASELINE" }, data: { activo: true } }),
      prisma.modeloEntrenado.update({ where: { id: m.id }, data: { deriva: true } }),
    ]);
    invalidarModelo(m.colaId);
    publicar({ tipo: "prediccion:modelo", localId: m.localId, colaId: m.colaId, modelo: "BASELINE", deriva: true });
    const { alertaDeSistema } = await import("@/lib/analitica/alertas");
    await alertaDeSistema(m.localId, "PREDICCION_DERIVA", `cola:${m.colaId}`, "Deriva del modelo de predicción", {
      colaId: m.colaId, modelo: m.tipo, maeProduccionMin: Math.round(maeProd / 6) / 10, maeValidacionMin: Math.round((m.mae ?? 0) / 6) / 10,
    }).catch(() => {});
  }
  return { derivas };
}

/** RF-M2-07: aviso "X min antes" (opt-in del cliente); se envía una sola vez. */
export async function jobAvisosMinutos(ahora = new Date()) {
  const pendientes = await prisma.turno.findMany({
    where: { avisoMinAntes: { not: null }, avisoMinEnviadoAt: null, estado: { in: ["EMITIDO", "AVISADO"] } },
    include: { cliente: true, local: true },
    take: 200,
  });
  let enviados = 0;
  for (const t of pendientes) {
    if (!(await moduloActivo(t.localId, "M2"))) continue;
    const pos = await prisma.$queryRaw<{ p: number }[]>`SELECT posicion_turno(${t.id}::int) AS p`;
    const p = await predecirParaTurno(t.colaId, Number(pos[0]?.p ?? 1) - 1, ahora);
    if (p.segundos > (t.avisoMinAntes ?? 0) * 60) continue;
    const r = await prisma.turno.updateMany({ where: { id: t.id, avisoMinEnviadoAt: null }, data: { avisoMinEnviadoAt: ahora } });
    if (!r.count) continue;
    const tel = t.cliente?.telefonoCifrado ? descifrar(t.cliente.telefonoCifrado) : null;
    const min = Math.max(1, Math.ceil(p.segundos / 60));
    const url = `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/t/${t.token}`;
    await enviarAviso({ localId: t.localId, turnoId: t.id, telefonoE164: tel, plantilla: "turno_proximo", parametros: [t.codigo, t.local.nombreComercial], texto: `⏳ Tu turno *${t.codigo}* en *${t.local.nombreComercial}* será llamado en unos ${min} min. Acércate a la sala. ${url}` });
    enviados++;
  }
  return { enviados };
}

export async function configurarAviso(token: string, minAntes: number | null) {
  if (minAntes !== null && ![5, 10, 15].includes(minAntes)) throw new ErrorNegocio("M2_AVISO_INVALIDO", "Elige 5, 10 o 15 minutos", 422);
  const t = await prisma.turno.findUnique({ where: { token } });
  if (!t) throw new ErrorNegocio("TURNO_NO_ENCONTRADO", "El turno no existe", 404);
  if (!["EMITIDO", "AVISADO"].includes(t.estado)) throw new ErrorNegocio("TRANSICION_INVALIDA", "El turno ya no está en espera", 409);
  if (!(await moduloActivo(t.localId, "M2"))) throw new ErrorNegocio("MODULO_NO_DISPONIBLE", "El aviso por tiempo no está disponible en este local", 403);
  await prisma.turno.update({ where: { id: t.id }, data: { avisoMinAntes: minAntes, avisoMinEnviadoAt: null } });
  return { avisoMinAntes: minAntes };
}

/** §6.10 Mejores horas: espera media real por franja (8 semanas), suavizada y con contracción; resto del día. */
export async function mejoresHoras(colaId: number, ahora = new Date()) {
  const cola = await prisma.cola.findUnique({ where: { id: colaId }, include: { local: true } });
  if (!cola) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  const zona = cola.local.zonaHoraria;
  const { diaSemana, hora, minuto } = partesLocales(zona, ahora);
  const desde = new Date(ahora.getTime() - 56 * 86400000);
  const rows = await prisma.turno.findMany({
    where: { colaId, llamadoAt: { not: null }, emitidoAt: { gte: desde } },
    select: { emitidoAt: true, llamadoAt: true },
  });
  const porFranja = new Map<number, number[]>();
  const todas: number[] = [];
  for (const r of rows) {
    const f = franjaDe(r.emitidoAt, zona);
    if (f.dow !== diaSemana) continue;
    const min = (r.llamadoAt!.getTime() - r.emitidoAt.getTime()) / 60000;
    if (min < 0 || min > 240) continue;
    porFranja.set(f.franja, [...(porFranja.get(f.franja) ?? []), min]);
    todas.push(min);
  }
  if (todas.length < 10) return [];
  const mediaCola = media(todas);
  const k = 5;
  const bruto = new Map<number, number>();
  for (const [f, xs] of porFranja) bruto.set(f, (xs.length * media(xs) + k * mediaCola) / (xs.length + k));
  const actual = hora * 2 + Math.floor(minuto / 30);
  const franjas = [...bruto.keys()].filter((f) => f > actual).sort((a, b) => a - b);
  const suav = franjas.map((f) => {
    const vecinos = [f - 1, f, f + 1].map((x) => bruto.get(x)).filter((x): x is number => x !== undefined);
    return { f, v: media(vecinos) };
  });
  const valores = suav.map((s) => s.v);
  const p33 = cuantil(valores, 0.33);
  const p66 = cuantil(valores, 0.66);
  return suav.map((s) => ({
    franja: `${String(Math.floor(s.f / 2)).padStart(2, "0")}:${s.f % 2 ? "30" : "00"}`,
    esperaMin: Math.round(s.v),
    nivel: s.v < p33 ? "baja" : s.v > p66 ? "alta" : "media",
  }));
}

/** GET /prediccion/metricas — por cola: métricas por modelo, serie real vs predicho, importancia y deriva. */
export async function metricasPrediccion(localId: number, colaId: number, dias = 14) {
  const cola = await prisma.cola.findFirst({ where: { id: colaId, localId } });
  if (!cola) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  const ultima = await prisma.modeloEntrenado.aggregate({ where: { colaId }, _max: { version: true } });
  const modelos = await prisma.modeloEntrenado.findMany({ where: { colaId, version: ultima._max.version ?? -1 }, orderBy: { tipo: "asc" } });
  const activo = await prisma.modeloEntrenado.findFirst({ where: { colaId, activo: true } });
  const serie = await prisma.prediccionLog.findMany({
    where: { colaId, realSeg: { not: null }, createdAt: { gte: new Date(Date.now() - dias * 86400000) } },
    orderBy: { createdAt: "asc" },
    take: 400,
    select: { createdAt: true, predSeg: true, loSeg: true, hiSeg: true, realSeg: true, tipo: true },
  });
  const prod = serie.length
    ? {
        n: serie.length,
        maeMin: media(serie.map((s) => Math.abs(s.predSeg - (s.realSeg ?? 0)))) / 60,
        cobertura: serie.filter((s) => (s.realSeg ?? 0) >= s.loSeg && (s.realSeg ?? 0) <= s.hiSeg).length / serie.length,
      }
    : null;
  return {
    activo: activo ? { tipo: activo.tipo, version: activo.version, entrenadoAt: activo.entrenadoAt, deriva: modelos.some((m) => m.deriva) } : null,
    modelos: modelos.map((m) => ({
      tipo: m.tipo,
      activo: m.id === activo?.id,
      n: m.nMuestras,
      maeMin: m.mae != null ? m.mae / 60 : null,
      medaeMin: m.medae != null ? m.medae / 60 : null,
      acierto5: m.acierto5,
      sesgoMin: m.sesgo != null ? m.sesgo / 60 : null,
      cobertura: m.cobertura,
      anchoMin: m.anchoMedio != null ? m.anchoMedio / 60 : null,
      importancia: m.importancia,
      entrenadoAt: m.entrenadoAt,
    })),
    produccion: prod,
    serie: serie.map((s) => ({ t: s.createdAt, pred: Math.round(s.predSeg / 6) / 10, lo: Math.round(s.loSeg / 6) / 10, hi: Math.round(s.hiSeg / 6) / 10, real: Math.round((s.realSeg ?? 0) / 6) / 10 })),
  };
}
