import { mediana } from "@/lib/prediccion/cuantiles";

/** M7 · Reglas puras: anomalías (MAD), FSM de alertas y periodos de reportes. */

// ---------------------------------------------------------------------------
// §6.4 Detección de anomalías con z robusto (Iglewicz–Hoaglin)
// ---------------------------------------------------------------------------
export function zRobusto(baseline: number[], observado: number, fraccion = 1) {
  if (baseline.length < 4 || fraccion < 0.5) return null;
  const med = mediana(baseline);
  const madv = mediana(baseline.map((x) => Math.abs(x - med)));
  const escala = Math.max(madv, 1);
  const esperado = med * fraccion;
  return (0.6745 * (observado - esperado)) / (escala * Math.sqrt(fraccion));
}

export function esAnomalia(z: number | null, umbral = 3.5) {
  return z !== null && Math.abs(z) > umbral;
}

// ---------------------------------------------------------------------------
// §6.5 FSM de alertas (pura, reloj inyectado)
// ---------------------------------------------------------------------------
export type EstadoAlerta = "ABIERTA" | "RECONOCIDA" | "RESUELTA" | "SILENCIADA";

export interface Nivel {
  traMin: number;
  canales: ("IN_APP" | "WHATSAPP" | "CORREO")[];
  usuarios?: number[];
}

export interface AlertaViva {
  estado: EstadoAlerta;
  nivel: number;
  primeraVezMs: number;
  proximoEscalaMs: number | null;
  silenciadaHastaMs: number | null;
  resueltaMs: number | null;
}

export interface Racha {
  disparos: number;
  normalDesdeMs: number | null;
}

export type Decision =
  | { tipo: "NADA" }
  | { tipo: "ABRIR"; nivel: 1; proximoEscalaMs: number | null }
  | { tipo: "REABRIR"; proximoEscalaMs: number | null }
  | { tipo: "REPETIR" }
  | { tipo: "RESOLVER" }
  | { tipo: "ESCALAR"; nivel: number; proximoEscalaMs: number | null }
  | { tipo: "DESILENCIAR" };

export interface EntradaFsm {
  dispara: boolean;
  ahoraMs: number;
  racha: Racha;
  /** Alerta viva (ABIERTA/RECONOCIDA/SILENCIADA) o la última resuelta (para anti-flapping). */
  alerta: AlertaViva | null;
  niveles: Nivel[];
  resolverTrasMin: number;
}

function proximoEscala(niveles: Nivel[], nivelActual: number, desdeMs: number) {
  const sig = niveles[nivelActual]; // niveles[0] es el nivel 1
  return sig ? desdeMs + sig.traMin * 60000 : null;
}

/** Avanza la racha y decide qué hacer con la alerta. Devuelve la racha nueva y la decisión. */
export function avanzarAlerta(e: EntradaFsm): { racha: Racha; decision: Decision } {
  const racha: Racha = e.dispara
    ? { disparos: e.racha.disparos + 1, normalDesdeMs: null }
    : { disparos: 0, normalDesdeMs: e.racha.normalDesdeMs ?? e.ahoraMs };
  const a = e.alerta;
  const viva = a && a.estado !== "RESUELTA";

  if (a?.estado === "SILENCIADA" && a.silenciadaHastaMs !== null && e.ahoraMs >= a.silenciadaHastaMs) {
    return { racha, decision: e.dispara ? { tipo: "DESILENCIAR" } : { tipo: "RESOLVER" } };
  }
  if (e.dispara) {
    if (viva) {
      if (a!.estado === "ABIERTA" && a!.proximoEscalaMs !== null && e.ahoraMs >= a!.proximoEscalaMs && a!.nivel < e.niveles.length) {
        const nivel = a!.nivel + 1;
        return { racha, decision: { tipo: "ESCALAR", nivel, proximoEscalaMs: proximoEscala(e.niveles, nivel, a!.primeraVezMs) } };
      }
      return { racha, decision: { tipo: "REPETIR" } };
    }
    if (racha.disparos >= 2) {
      // Anti-flapping: recurrencia ≤ 30 min tras resolverse ⇒ se reabre la misma alerta sin renotificar el nivel 1
      if (a?.estado === "RESUELTA" && a.resueltaMs !== null && e.ahoraMs - a.resueltaMs <= 30 * 60000) {
        return { racha, decision: { tipo: "REABRIR", proximoEscalaMs: proximoEscala(e.niveles, 1, e.ahoraMs) } };
      }
      return { racha, decision: { tipo: "ABRIR", nivel: 1, proximoEscalaMs: proximoEscala(e.niveles, 1, e.ahoraMs) } };
    }
    return { racha, decision: { tipo: "NADA" } };
  }
  // Normal: se resuelve sola tras `resolverTrasMin` minutos sostenidos
  if (viva && (a!.estado === "ABIERTA" || a!.estado === "RECONOCIDA") && racha.normalDesdeMs !== null && e.ahoraMs - racha.normalDesdeMs >= e.resolverTrasMin * 60000) {
    return { racha, decision: { tipo: "RESOLVER" } };
  }
  // Escalamiento también corre mientras la condición está "normal" pero la alerta sigue abierta sin reconocer
  if (viva && a!.estado === "ABIERTA" && a!.proximoEscalaMs !== null && e.ahoraMs >= a!.proximoEscalaMs && a!.nivel < e.niveles.length) {
    const nivel = a!.nivel + 1;
    return { racha, decision: { tipo: "ESCALAR", nivel, proximoEscalaMs: proximoEscala(e.niveles, nivel, a!.primeraVezMs) } };
  }
  return { racha, decision: { tipo: "NADA" } };
}

// ---------------------------------------------------------------------------
// §6.7 Periodos de reportes (zona del local)
// ---------------------------------------------------------------------------

/** Semana ISO de una fecha yyyy-mm-dd ⇒ "2026-W43". */
export function semanaIso(fechaISO: string) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dia = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dia);
  const inicioAnio = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((dt.getTime() - inicioAnio.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(semana).padStart(2, "0")}`;
}

export interface Programacion {
  frecuencia: "DIARIO" | "SEMANAL" | "MENSUAL";
  diaSemana?: number | null;
  diaMes?: number | null;
  hora: string;
}

/**
 * ¿Toca ejecutar ahora? (fecha local y hora local). Devuelve la clave del periodo **cerrado** que se reporta:
 * diario ⇒ ayer; semanal ⇒ semana anterior; mensual ⇒ mes anterior.
 */
export function periodoQueToca(p: Programacion, fechaLocal: string, diaSemanaLocal: number, minutosLocal: number) {
  const [hh, mm] = p.hora.split(":").map(Number);
  if (minutosLocal < hh * 60 + mm) return null;
  const ayer = new Date(Date.parse(`${fechaLocal}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (p.frecuencia === "DIARIO") return { periodo: ayer, desde: ayer, hasta: ayer };
  if (p.frecuencia === "SEMANAL") {
    if ((p.diaSemana ?? 1) !== diaSemanaLocal) return null;
    const hasta = ayer;
    const desde = new Date(Date.parse(`${hasta}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
    return { periodo: semanaIso(desde), desde, hasta };
  }
  const dia = Number(fechaLocal.slice(8, 10));
  if ((p.diaMes ?? 1) !== dia) return null;
  const [y, m] = fechaLocal.split("-").map(Number);
  const mesAnterior = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const ultimo = new Date(Date.UTC(Number(mesAnterior.slice(0, 4)), Number(mesAnterior.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return { periodo: mesAnterior, desde: `${mesAnterior}-01`, hasta: ultimo };
}

/** Huella de deduplicación (RN-M7-02). */
export function huella(tipo: string, localId: number, entidad: string | null) {
  return `${tipo}|${localId}|${entidad ?? "-"}`;
}
