import { z } from "zod";

/**
 * M6 · Reglas puras del balanceo (docs/modulos/M6-transferencia-balanceo.md §6.2–6.5). Sin I/O, reloj inyectado.
 */

export const METRICAS = ["en_espera", "espera_max_min", "espera_prom_min", "ventanillas_operativas", "ventanillas_libres", "utilizacion", "tasa_llegada_15m", "sla_cumplimiento", "espera_prom_local"] as const;
export type Metrica = (typeof METRICAS)[number];
export const OPERADORES = [">", ">=", "<", "<=", "=="] as const;

export interface Comparacion {
  metric: Metrica;
  scope?: { cola?: number };
  op: (typeof OPERADORES)[number];
  value: number;
}
export type Condicion = Comparacion | { all: Condicion[] } | { any: Condicion[] } | { not: Condicion };

const comparacionSchema = z.object({
  metric: z.enum(METRICAS),
  scope: z.object({ cola: z.number().int().positive().optional() }).optional(),
  op: z.enum(OPERADORES),
  value: z.number().finite(),
});
export const condicionSchema: z.ZodType<Condicion> = z.lazy(() =>
  z.union([comparacionSchema, z.object({ all: z.array(condicionSchema).min(1).max(10) }), z.object({ any: z.array(condicionSchema).min(1).max(10) }), z.object({ not: condicionSchema })]),
);

export const accionSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("ABRIR_VENTANILLA"), ventanillaId: z.number().int().positive(), colaId: z.number().int().positive().optional() }),
  z.object({ tipo: z.literal("MOVER_OPERADOR"), desdeColaId: z.number().int().positive(), haciaColaId: z.number().int().positive(), ventanillaId: z.number().int().positive().optional() }),
  z.object({ tipo: z.literal("DERIVAR_TURNOS"), deColaId: z.number().int().positive(), aColaId: z.number().int().positive(), cantidad: z.number().int().min(1).max(20) }),
  z.object({ tipo: z.literal("NOTIFICAR"), mensaje: z.string().min(3).max(200) }),
  z.object({ tipo: z.literal("AJUSTAR_ALFA"), delta: z.number().min(-2).max(2) }),
]);
export type Accion = z.infer<typeof accionSchema>;

/** Métricas por cola + del local (lo que devuelve la consulta única). */
export interface MetricasLocal {
  colas: Record<number, Partial<Record<Metrica, number>>>;
  local: { espera_prom_local: number };
}

export function valor(m: MetricasLocal, c: Comparacion): number | null {
  if (c.metric === "espera_prom_local") return m.local.espera_prom_local;
  const colas = c.scope?.cola ? [c.scope.cola] : Object.keys(m.colas).map(Number);
  const vals = colas.map((id) => m.colas[id]?.[c.metric]).filter((v): v is number => typeof v === "number");
  if (!vals.length) return null;
  // Sin alcance: la peor cola (máximo) para métricas de carga
  return Math.max(...vals);
}

function compara(a: number, op: Comparacion["op"], b: number) {
  return op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : op === "<=" ? a <= b : a === b;
}

export function evaluar(cond: Condicion, m: MetricasLocal): boolean {
  if ("all" in cond) return cond.all.every((c) => evaluar(c, m));
  if ("any" in cond) return cond.any.some((c) => evaluar(c, m));
  if ("not" in cond) return !evaluar(cond.not, m);
  const v = valor(m, cond);
  return v !== null && compara(v, cond.op, cond.value);
}

/**
 * Condición de salida con histéresis (RN-M6-06): para cada comparación "mayor que" el umbral baja a
 * value × (1 − h); para "menor que" sube a value × (1 + h). Se revierte cuando la condición endurecida ya no se cumple.
 */
export function condicionSalida(cond: Condicion, histeresisPct: number): Condicion {
  const h = histeresisPct / 100;
  if ("all" in cond) return { all: cond.all.map((c) => condicionSalida(c, histeresisPct)) };
  if ("any" in cond) return { any: cond.any.map((c) => condicionSalida(c, histeresisPct)) };
  if ("not" in cond) return { not: condicionSalida(cond.not, histeresisPct) };
  if (cond.op === ">" || cond.op === ">=") return { ...cond, value: cond.value * (1 - h) };
  if (cond.op === "<" || cond.op === "<=") return { ...cond, value: cond.value * (1 + h) };
  return cond;
}

/** RN-M6-10: condición imposible (x > a y x < b con b ≤ a) dentro de un mismo `all`. */
export function condicionImposible(cond: Condicion): boolean {
  if ("any" in cond) return cond.any.every(condicionImposible);
  if ("not" in cond) return false;
  if (!("all" in cond)) return false;
  const comps = cond.all.filter((c): c is Comparacion => "metric" in c);
  for (const a of comps) {
    for (const b of comps) {
      if (a === b || a.metric !== b.metric || (a.scope?.cola ?? 0) !== (b.scope?.cola ?? 0)) continue;
      const min = a.op === ">" || a.op === ">=" ? a.value : null;
      const max = b.op === "<" || b.op === "<=" ? b.value : null;
      if (min !== null && max !== null && (max < min || (max === min && (a.op === ">" || b.op === "<")))) return true;
    }
  }
  return cond.all.some((c) => !("metric" in c) && condicionImposible(c));
}

export interface ReglaDef {
  id: number;
  accion: Accion;
  forSegundos: number;
  cooldownSeg: number;
  activa: boolean;
}

/** RN-M6-10: dos reglas que mueven operadores entre las mismas colas en sentido opuesto y sin separación suficiente. */
export function reglasContradictorias(nueva: ReglaDef, otras: ReglaDef[]) {
  if (nueva.accion.tipo !== "MOVER_OPERADOR") return null;
  const n = nueva.accion;
  for (const o of otras) {
    if (!o.activa || o.id === nueva.id || o.accion.tipo !== "MOVER_OPERADOR") continue;
    const a = o.accion;
    if (a.desdeColaId === n.haciaColaId && a.haciaColaId === n.desdeColaId) {
      if (Math.min(nueva.cooldownSeg, o.cooldownSeg) < 2 * Math.max(nueva.forSegundos, o.forSegundos)) return o.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// §6.4 Evaluador: máquina de estados por regla
// ---------------------------------------------------------------------------
export type Fase = "INACTIVA" | "ARMADA" | "ACTIVA";

export interface EstadoRegla {
  fase: Fase;
  verdaderaDesdeMs: number | null;
  falsaDesdeMs: number | null;
  ultimaEjecucionMs: number | null;
  ejecutadaMs: number | null;
}

export interface ConfigEvaluador {
  forSegundos: number;
  forSegundosReversa: number;
  cooldownSeg: number;
  ttlSeg: number | null;
  reversible: boolean;
}

export type DecisionRegla = "NADA" | "EJECUTAR" | "REVERTIR" | "OMITIDA_COOLDOWN";

/**
 * `cond` = la condición de disparo; `salida` = la condición endurecida con histéresis (verdadera mientras haga falta
 * mantener la acción). Devuelve el estado siguiente y la decisión. La comprobación del límite por hora y de la
 * exclusión mutua la hace el orquestador (dependen de otras reglas).
 */
export function avanzar(e: EstadoRegla, cond: boolean, salida: boolean, ahoraMs: number, cfg: ConfigEvaluador): { estado: EstadoRegla; decision: DecisionRegla } {
  if (e.fase === "INACTIVA") {
    if (!cond) return { estado: { ...e, verdaderaDesdeMs: null }, decision: "NADA" };
    const armada = { ...e, fase: "ARMADA" as Fase, verdaderaDesdeMs: ahoraMs, falsaDesdeMs: null };
    return cfg.forSegundos <= 0 ? avanzar(armada, cond, salida, ahoraMs, cfg) : { estado: armada, decision: "NADA" };
  }
  if (e.fase === "ARMADA") {
    // Un parpadeo de la condición reinicia el armado (RN-M6-04)
    if (!cond) return { estado: { ...e, fase: "INACTIVA", verdaderaDesdeMs: null }, decision: "NADA" };
    if (ahoraMs - (e.verdaderaDesdeMs ?? ahoraMs) < cfg.forSegundos * 1000) return { estado: e, decision: "NADA" };
    if (e.ultimaEjecucionMs !== null && ahoraMs - e.ultimaEjecucionMs < cfg.cooldownSeg * 1000) return { estado: e, decision: "OMITIDA_COOLDOWN" };
    const fase: Fase = cfg.reversible ? "ACTIVA" : "INACTIVA";
    return { estado: { ...e, fase, ultimaEjecucionMs: ahoraMs, ejecutadaMs: ahoraMs, verdaderaDesdeMs: null, falsaDesdeMs: null }, decision: "EJECUTAR" };
  }
  // ACTIVA: revertir si la salida con histéresis deja de cumplirse sostenidamente, o si vence el TTL
  if (cfg.ttlSeg && e.ejecutadaMs !== null && ahoraMs - e.ejecutadaMs >= cfg.ttlSeg * 1000) {
    return { estado: { ...e, fase: "INACTIVA", falsaDesdeMs: null, ejecutadaMs: null }, decision: "REVERTIR" };
  }
  if (salida) return { estado: { ...e, falsaDesdeMs: null }, decision: "NADA" };
  const falsaDesde = e.falsaDesdeMs ?? ahoraMs;
  if (ahoraMs - falsaDesde >= cfg.forSegundosReversa * 1000) {
    return { estado: { ...e, fase: "INACTIVA", falsaDesdeMs: null, ejecutadaMs: null }, decision: "REVERTIR" };
  }
  return { estado: { ...e, falsaDesdeMs: falsaDesde }, decision: "NADA" };
}

export const MAX_ACCIONES_HORA = 6;

/** Descripción legible para el modo simulación ("habría movido…"). */
export function describirAccion(a: Accion, nombres: Record<number, string> = {}) {
  const n = (id?: number) => (id ? (nombres[id] ?? `#${id}`) : "?");
  switch (a.tipo) {
    case "ABRIR_VENTANILLA":
      return `abrir la ventanilla ${n(a.ventanillaId)}`;
    case "MOVER_OPERADOR":
      return `mover una ventanilla de ${n(a.desdeColaId)} a ${n(a.haciaColaId)}`;
    case "DERIVAR_TURNOS":
      return `derivar ${a.cantidad} turnos de ${n(a.deColaId)} a ${n(a.aColaId)}`;
    case "NOTIFICAR":
      return `avisar: "${a.mensaje}"`;
    case "AJUSTAR_ALFA":
      return `ajustar α de prioridades en ${a.delta > 0 ? "+" : ""}${a.delta}`;
  }
}

export function esReversible(a: Accion) {
  return a.tipo === "ABRIR_VENTANILLA" || a.tipo === "MOVER_OPERADOR" || a.tipo === "AJUSTAR_ALFA";
}

/** Sugerencia simple (botón "Balancear ahora"): mover de la cola más vacía a la más llena. */
export interface CargaCola {
  colaId: number;
  enEspera: number;
  ventanillas: number;
}

export function sugerirMovimiento(cargas: CargaCola[], umbral = 5) {
  if (cargas.length < 2) return null;
  const orden = [...cargas].sort((a, b) => b.enEspera - a.enEspera);
  const llena = orden[0];
  const vacia = orden[orden.length - 1];
  if (vacia.ventanillas < 2) return null;
  if (llena.enEspera - vacia.enEspera < umbral) return null;
  return { desde: vacia.colaId, hacia: llena.colaId, diferencia: llena.enEspera - vacia.enEspera };
}
