import { barajar, cuantil, media, mediana, mulberry32 } from "@/lib/prediccion/cuantiles";

/**
 * M2 · Modelos de predicción de espera (docs/modulos/M2-prediccion-espera.md §6). Funciones puras.
 *
 *   W = espera hasta ser llamado (segundos) · k = personas delante · c = ventanillas operativas
 *   BASELINE   W = (k + 1) · promedio(últimos 10 servicios)                     (RN02)
 *   EMA        W = ((k + 1) / c) · s̄,   s̄ ← α·x + (1 − α)·s̄
 *   ESTACIONAL W = φ_{d,b} · ((k + 1) / c) · s̄_{d,b},  s̄_{d,b} con contracción hacia la mediana de la cola (κ = 10)
 *
 * El estado se actualiza **solo** con información ya ocurrida (cierres de atención y llamados), por eso el replay
 * cronológico no tiene fuga de datos (RNF-M2-03).
 */

export type TipoModelo = "BASELINE" | "EMA" | "ESTACIONAL";
export const TIPOS: TipoModelo[] = ["BASELINE", "EMA", "ESTACIONAL"];

export const KAPPA = 10;
export const ALFA_PHI = 0.2;
export const SERVICIO_MIN_SEG = 30;
export const SERVICIO_MAX_SEG = 3600;
const MAX_CELDA = 60;

export interface EstadoModelo {
  tipo: TipoModelo;
  base: number;
  alfa: number;
  ultimos: number[];
  sbar: number;
  /** Servicios recientes por celda "dow-franja" (para la mediana de la celda). */
  celdas: Record<string, number[]>;
  /** Todos los servicios recientes de la cola (mediana m_q). */
  cola: number[];
  /** Corrección multiplicativa por celda, acotada a [0.5, 2]. */
  phi: Record<string, number>;
  /** Cuantiles del error relativo para el intervalo, por grupo horario. */
  intervalo: { manana: [number, number] | null; tarde: [number, number] | null; cola: [number, number] | null };
  nServicios: number;
}

export function estadoInicial(tipo: TipoModelo, base: number, alfa = 0.2): EstadoModelo {
  return { tipo, base, alfa, ultimos: [], sbar: base, celdas: {}, cola: [], phi: {}, intervalo: { manana: null, tarde: null, cola: null }, nServicios: 0 };
}

export const celda = (dow: number, franja: number) => `${dow}-${franja}`;

export function servicioValido(seg: number) {
  return seg >= SERVICIO_MIN_SEG && seg <= SERVICIO_MAX_SEG;
}

/** Actualización en línea al cerrar una atención (EMA, celdas y baseline). Muta el estado. */
export function actualizarServicio(e: EstadoModelo, servicioSeg: number, dow: number, franja: number) {
  if (!servicioValido(servicioSeg)) return e;
  // Winsorización en línea al p99 aproximado de lo visto
  const tope = e.cola.length >= 20 ? cuantil(e.cola, 0.99) : SERVICIO_MAX_SEG;
  const x = Math.min(servicioSeg, tope);
  e.ultimos.push(x);
  if (e.ultimos.length > 10) e.ultimos.shift();
  e.sbar = e.nServicios === 0 ? x : e.alfa * x + (1 - e.alfa) * e.sbar;
  const k = celda(dow, franja);
  const lista = (e.celdas[k] ??= []);
  lista.push(x);
  if (lista.length > MAX_CELDA) lista.shift();
  e.cola.push(x);
  if (e.cola.length > 500) e.cola.shift();
  e.nServicios++;
  return e;
}

/** s̄_{d,b} con contracción empírico-Bayes hacia la mediana de la cola. */
export function servicioCelda(e: EstadoModelo, dow: number, franja: number) {
  const mq = e.cola.length ? mediana(e.cola) : e.base;
  const xs = e.celdas[celda(dow, franja)] ?? [];
  if (!xs.length) return mq;
  const n = xs.length;
  return (n * mediana(xs) + KAPPA * mq) / (n + KAPPA);
}

function phiDe(e: EstadoModelo, dow: number, franja: number) {
  const exacto = e.phi[celda(dow, franja)];
  if (exacto !== undefined) return exacto;
  // Franja vecina más cercana del mismo día; en último caso 1
  for (let d = 1; d <= 4; d++) {
    const a = e.phi[celda(dow, franja - d)];
    if (a !== undefined) return a;
    const b = e.phi[celda(dow, franja + d)];
    if (b !== undefined) return b;
  }
  return 1;
}

/** Predicción puntual (segundos). */
export function predecir(e: EstadoModelo, k: number, c: number, dow: number, franja: number) {
  const kk = Math.max(0, k);
  const cc = Math.max(1, c);
  if (e.tipo === "BASELINE") {
    const prom = e.ultimos.length ? media(e.ultimos) : e.base;
    return (kk + 1) * (prom < SERVICIO_MIN_SEG ? e.base : prom);
  }
  if (e.tipo === "EMA") return ((kk + 1) / cc) * e.sbar;
  const est = ((kk + 1) / cc) * servicioCelda(e, dow, franja);
  return phiDe(e, dow, franja) * est;
}

/** Aprende φ cuando se revela la espera real de una emisión (solo ESTACIONAL). */
export function actualizarPhi(e: EstadoModelo, realSeg: number, estructuralSeg: number, dow: number, franja: number) {
  if (e.tipo !== "ESTACIONAL" || estructuralSeg <= 0) return e;
  const r = Math.min(2, Math.max(0.5, realSeg / Math.max(estructuralSeg, SERVICIO_MIN_SEG)));
  const k = celda(dow, franja);
  const previo = e.phi[k] ?? 1;
  e.phi[k] = Math.min(2, Math.max(0.5, ALFA_PHI * r + (1 - ALFA_PHI) * previo));
  return e;
}

export function estructural(e: EstadoModelo, k: number, c: number, dow: number, franja: number) {
  return ((Math.max(0, k) + 1) / Math.max(1, c)) * servicioCelda(e, dow, franja);
}

/** Intervalo [lo, hi] (§6.5): pred × cuantiles del error relativo; si no hay calibración, [0.65, 1.45]. */
export function intervalo(e: EstadoModelo, pred: number, franja: number) {
  const grupo = franja < 26 ? e.intervalo.manana : e.intervalo.tarde;
  const q = grupo ?? e.intervalo.cola ?? [0.65, 1.45];
  return { lo: Math.max(0, pred * q[0]), hi: Math.max(pred, pred * q[1]) };
}

/** Calcula los cuantiles de la conformalización dividida a partir de pares (pred, real). */
export function calibrarIntervalo(pares: { pred: number; real: number; franja: number }[], nivel: number) {
  const qlo = (1 - nivel) / 2;
  const qhi = (1 + nivel) / 2;
  const ratio = (p: { pred: number; real: number }) => p.real / Math.max(p.pred, SERVICIO_MIN_SEG);
  const grupo = (xs: typeof pares, min: number): [number, number] | null => {
    if (xs.length < min) return null;
    const r = xs.map(ratio);
    return [Math.min(1, cuantil(r, qlo)), Math.max(1, cuantil(r, qhi))];
  };
  return {
    manana: grupo(pares.filter((p) => p.franja < 26), 50),
    tarde: grupo(pares.filter((p) => p.franja >= 26), 50),
    cola: grupo(pares, 30),
  };
}

// ---------------------------------------------------------------------------
// Replay cronológico (walk-forward) §6.6
// ---------------------------------------------------------------------------

export interface MuestraTurno {
  id: number;
  emitidoMs: number;
  llamadoMs: number | null;
  finalizadoMs: number | null;
  atendido: boolean;
  delante: number;
  c: number;
  dow: number;
  franja: number;
}

export interface Par {
  id: number;
  tMs: number;
  pred: number;
  real: number;
  lo: number;
  hi: number;
  k: number;
  c: number;
  dow: number;
  franja: number;
}

/**
 * Recorre los eventos en orden temporal: EMISION (predice con el estado de ese instante), LLAMADO (revela la
 * espera real y aprende φ) y CIERRE (actualiza el servicio). Devuelve los pares y el estado final.
 */
export function replay(muestras: MuestraTurno[], inicial: EstadoModelo) {
  type Ev = { t: number; orden: number; tipo: "EMISION" | "LLAMADO" | "CIERRE"; m: MuestraTurno };
  const eventos: Ev[] = [];
  for (const m of muestras) {
    eventos.push({ t: m.emitidoMs, orden: 1, tipo: "EMISION", m });
    if (m.llamadoMs != null) eventos.push({ t: m.llamadoMs, orden: 0, tipo: "LLAMADO", m });
    if (m.atendido && m.llamadoMs != null && m.finalizadoMs != null) eventos.push({ t: m.finalizadoMs, orden: 0, tipo: "CIERRE", m });
  }
  // A igual instante, primero lo que ya ocurrió (cierres/llamados) y luego la emisión
  eventos.sort((a, b) => a.t - b.t || a.orden - b.orden || a.m.id - b.m.id);
  const e: EstadoModelo = structuredClone(inicial);
  const pendientes = new Map<number, { pred: number; est: number; lo: number; hi: number }>();
  const pares: Par[] = [];
  for (const ev of eventos) {
    const m = ev.m;
    if (ev.tipo === "EMISION") {
      const pred = predecir(e, m.delante, m.c, m.dow, m.franja);
      const iv = intervalo(e, pred, m.franja);
      pendientes.set(m.id, { pred, est: estructural(e, m.delante, m.c, m.dow, m.franja), lo: iv.lo, hi: iv.hi });
    } else if (ev.tipo === "LLAMADO") {
      const p = pendientes.get(m.id);
      if (!p || m.llamadoMs == null) continue;
      const real = (m.llamadoMs - m.emitidoMs) / 1000;
      if (real < 0 || real > 8 * 3600) continue;
      pares.push({ id: m.id, tMs: m.emitidoMs, pred: p.pred, real, lo: p.lo, hi: p.hi, k: m.delante, c: m.c, dow: m.dow, franja: m.franja });
      actualizarPhi(e, real, p.est, m.dow, m.franja);
      pendientes.delete(m.id);
    } else if (m.llamadoMs != null && m.finalizadoMs != null) {
      actualizarServicio(e, (m.finalizadoMs - m.llamadoMs) / 1000, m.dow, m.franja);
    }
  }
  return { pares, estado: e };
}

export interface Metricas {
  n: number;
  mae: number;
  medae: number;
  mape: number;
  acierto5: number;
  sesgo: number;
  cobertura: number;
  anchoMedio: number;
}

export function metricas(pares: Pick<Par, "pred" | "real" | "lo" | "hi">[]): Metricas {
  if (!pares.length) return { n: 0, mae: 0, medae: 0, mape: 0, acierto5: 0, sesgo: 0, cobertura: 0, anchoMedio: 0 };
  const err = pares.map((p) => p.pred - p.real);
  const abs = err.map(Math.abs);
  return {
    n: pares.length,
    mae: media(abs),
    medae: mediana(abs),
    mape: media(pares.map((p) => Math.abs(p.pred - p.real) / Math.max(p.real, 120))),
    acierto5: abs.filter((a) => a <= 300).length / abs.length,
    sesgo: media(err),
    cobertura: pares.filter((p) => p.real >= p.lo && p.real <= p.hi).length / pares.length,
    anchoMedio: media(pares.map((p) => p.hi - p.lo)),
  };
}

/** RN-M2-02: elegibilidad por arranque en frío. */
export function elegibles(nServicios: number, diasHistoria: number): TipoModelo[] {
  if (nServicios < 30) return ["BASELINE"];
  if (nServicios < 200 || diasHistoria < 14) return ["BASELINE", "EMA"];
  return TIPOS;
}

/** RN-M2-06: cambia de modelo solo si mejora el MAE en ≥ 5 %. */
export function elegirModelo(maes: Partial<Record<TipoModelo, number>>, activo: TipoModelo | null, permitidos: TipoModelo[]) {
  const candidatos = permitidos.filter((t) => maes[t] !== undefined && Number.isFinite(maes[t]!));
  if (!candidatos.length) return "BASELINE" as TipoModelo;
  const mejor = candidatos.reduce((a, b) => (maes[b]! < maes[a]! ? b : a));
  if (!activo || !candidatos.includes(activo) || maes[activo] === undefined) return mejor;
  return maes[mejor]! <= 0.95 * maes[activo]! ? mejor : activo;
}

/** RN-M2-05: deriva si el MAE de producción supera 1.3 × el de validación. */
export function hayDeriva(maeProduccion: number, maeValidacion: number, n: number) {
  return n >= 20 && maeValidacion > 0 && maeProduccion > 1.3 * maeValidacion;
}

/** §6.7 Importancia por permutación sobre variables {k, c, franja, dow} con semilla fija. */
export function importanciaPermutacion(e: EstadoModelo, pares: Par[], semilla = 2026) {
  if (pares.length < 10) return null;
  const base = media(pares.map((p) => Math.abs(predecir(e, p.k, p.c, p.dow, p.franja) - p.real)));
  const rng = mulberry32(semilla);
  const vars = ["k", "c", "franja", "dow"] as const;
  const delta: Record<string, number> = {};
  for (const v of vars) {
    const perm = barajar(pares.map((p) => p[v]), rng);
    const mae = media(pares.map((p, i) => {
      const q = { ...p, [v]: perm[i] };
      return Math.abs(predecir(e, q.k, q.c, q.dow, q.franja) - p.real);
    }));
    delta[v] = Math.max(0, mae - base);
  }
  const total = Object.values(delta).reduce((a, b) => a + b, 0);
  const nombres: Record<string, string> = { k: "Personas delante", c: "Ventanillas operativas", franja: "Franja horaria", dow: "Día de la semana" };
  return vars.map((v) => ({ variable: nombres[v], importancia: total > 0 ? Math.round((delta[v] / total) * 1000) / 10 : 0 }));
}

/** Entrena un tipo de modelo: replay completo, métricas en los últimos 7 días e intervalos calibrados sin fuga. */
export function entrenar(tipo: TipoModelo, muestras: MuestraTurno[], opciones: { base: number; alfa: number; nivel: number; ahoraMs: number }) {
  const { pares, estado } = replay(muestras, estadoInicial(tipo, opciones.base, opciones.alfa));
  const corteEval = opciones.ahoraMs - 7 * 86400000;
  const corteCal = corteEval - 14 * 86400000;
  // Intervalos: se calibran con los 14 días previos a la ventana de evaluación y se miden en ella (cobertura honesta)
  const cal = calibrarIntervalo(pares.filter((p) => p.tMs >= corteCal && p.tMs < corteEval), opciones.nivel);
  const evaluacion = pares.filter((p) => p.tMs >= corteEval);
  const evalPares = (evaluacion.length >= 20 ? evaluacion : pares.slice(-Math.max(20, Math.floor(pares.length / 3)))).map((p) => {
    const iv = { ...estado, intervalo: cal };
    const r = intervalo(iv, p.pred, p.franja);
    return { ...p, lo: r.lo, hi: r.hi };
  });
  // Parámetros desplegados: intervalos con los 14 días más recientes
  estado.intervalo = calibrarIntervalo(pares.filter((p) => p.tMs >= opciones.ahoraMs - 14 * 86400000), opciones.nivel);
  return { estado, metricas: metricas(evalPares), pares: evalPares };
}
