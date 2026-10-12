import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { contar, observar } from "@/lib/metricas";
import { fechaLocalISO, instanteLocal, sumarDiasISO } from "@/lib/fechas";
import type { Prisma } from "@/generated/prisma/client";

/**
 * F1 · Planificador de jobs (ADR-01, ver nota de decisión en docs/ARQUITECTURA.md).
 *
 * Cada job se **reclama** con un `UPDATE … WHERE proxima <= now() RETURNING` sobre `job_estado`: aunque haya varias
 * instancias de la app, solo una gana la corrida (singleton por BD, sin Redis ni pg-boss). Los handlers son idempotentes.
 */
export interface DefinicionJob {
  nombre: string;
  /** Cada cuántos segundos corre. */
  cadaSeg?: number;
  /** O bien una vez al día a esta hora local. */
  diario?: { hora: number; minuto?: number; zona?: string };
  descripcion: string;
  handler: () => Promise<unknown>;
}

const g = globalThis as unknown as { turnoyaJobs?: { defs: Map<string, DefinicionJob>; corriendo: Set<string>; timer?: ReturnType<typeof setInterval> } };
const estado = g.turnoyaJobs ?? { defs: new Map<string, DefinicionJob>(), corriendo: new Set<string>() };
g.turnoyaJobs = estado;

export function definirJob(def: DefinicionJob) {
  estado.defs.set(def.nombre, def);
}

export function jobsDefinidos() {
  return [...estado.defs.values()];
}

export function proximaCorrida(def: DefinicionJob, desde = new Date()): Date {
  if (def.cadaSeg) return new Date(desde.getTime() + def.cadaSeg * 1000);
  const zona = def.diario?.zona ?? "America/Lima";
  const hoy = fechaLocalISO(zona, desde);
  const candidato = instanteLocal(hoy, def.diario?.hora ?? 3, def.diario?.minuto ?? 0, zona);
  return candidato > desde ? candidato : instanteLocal(sumarDiasISO(hoy, 1), def.diario?.hora ?? 3, def.diario?.minuto ?? 0, zona);
}

/** Intenta reclamar la corrida; devuelve true si esta instancia debe ejecutarla. */
async function reclamar(def: DefinicionJob, ahora: Date) {
  await prisma.$executeRaw`INSERT INTO job_estado (nombre, proxima) VALUES (${def.nombre}, ${def.cadaSeg ? ahora : proximaCorrida(def, ahora)}) ON CONFLICT (nombre) DO NOTHING`;
  const rows = await prisma.$queryRaw<{ nombre: string }[]>`
    UPDATE job_estado SET proxima = ${proximaCorrida(def, ahora)}
     WHERE nombre = ${def.nombre} AND (proxima IS NULL OR proxima <= ${ahora})
    RETURNING nombre`;
  return rows.length > 0;
}

export async function ejecutarJob(def: DefinicionJob) {
  if (estado.corriendo.has(def.nombre)) return { omitido: true };
  estado.corriendo.add(def.nombre);
  const t0 = performance.now();
  try {
    const resultado = await def.handler();
    const ms = Math.round(performance.now() - t0);
    observar("job_duracion_ms", ms, { job: def.nombre });
    contar("job_corridas_total", { job: def.nombre, resultado: "ok" });
    await prisma.jobEstado.update({
      where: { nombre: def.nombre },
      data: { ultimaCorrida: new Date(), ultimaDuracionMs: ms, ultimoResultado: (resultado ?? null) as Prisma.InputJsonValue, ultimoError: null, corridas: { increment: 1 } },
    }).catch(() => {});
    if (resultado && typeof resultado === "object" && Object.values(resultado).some((v) => typeof v === "number" && v > 0)) {
      log.info("job", { job: def.nombre, duracion_ms: ms, resultado });
    }
    return resultado;
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const msg = e instanceof Error ? e.message : String(e);
    contar("job_corridas_total", { job: def.nombre, resultado: "error" });
    log.error("job falló", { job: def.nombre, duracion_ms: ms, error: msg });
    await prisma.jobEstado.update({
      where: { nombre: def.nombre },
      data: { ultimaCorrida: new Date(), ultimaDuracionMs: ms, ultimoError: msg.slice(0, 500), corridas: { increment: 1 }, fallos: { increment: 1 } },
    }).catch(() => {});
    return { error: msg };
  } finally {
    estado.corriendo.delete(def.nombre);
  }
}

/** Una pasada: corre los jobs que "tocan" y que esta instancia logra reclamar. */
export async function tick(ahora = new Date()) {
  for (const def of estado.defs.values()) {
    if (estado.corriendo.has(def.nombre)) continue;
    try {
      if (await reclamar(def, ahora)) void ejecutarJob(def);
    } catch (e) {
      log.warn("no se pudo reclamar job", { job: def.nombre, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

export function iniciarScheduler(intervaloMs = 5_000) {
  if (estado.timer) return;
  estado.timer = setInterval(() => void tick().catch(() => {}), intervaloMs);
  log.info("scheduler iniciado", { jobs: [...estado.defs.keys()] });
}

export function detenerScheduler() {
  if (estado.timer) clearInterval(estado.timer);
  estado.timer = undefined;
}

export async function estadoJobs() {
  const filas = await prisma.jobEstado.findMany();
  return jobsDefinidos().map((d) => {
    const f = filas.find((x) => x.nombre === d.nombre);
    return {
      nombre: d.nombre,
      descripcion: d.descripcion,
      frecuencia: d.cadaSeg ? `cada ${d.cadaSeg} s` : `diario ${String(d.diario?.hora ?? 3).padStart(2, "0")}:${String(d.diario?.minuto ?? 0).padStart(2, "0")}`,
      ultimaCorrida: f?.ultimaCorrida ?? null,
      ultimaDuracionMs: f?.ultimaDuracionMs ?? null,
      ultimoResultado: f?.ultimoResultado ?? null,
      ultimoError: f?.ultimoError ?? null,
      corridas: f?.corridas ?? 0,
      fallos: f?.fallos ?? 0,
      proxima: f?.proxima ?? null,
      enCurso: estado.corriendo.has(d.nombre),
    };
  });
}
