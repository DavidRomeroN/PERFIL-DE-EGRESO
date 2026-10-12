/**
 * M1 · Reglas puras del motor de prioridades (sin I/O). Ver docs/modulos/M1-prioridades.md §6.
 *
 *   clave = peso_efectivo − α · minutos_desde_origen(emitido)      (mayor clave ⇒ primero)
 *
 * El orden relativo de dos turnos no depende de "ahora" (propiedad §6.1), por eso la clave se persiste e indexa.
 */

export const ORIGEN_CLAVE_MS = Date.parse("2026-01-01T00:00:00Z");
export const PESO_ABSOLUTO = 1_000_000;

export interface ConfigPrioridad {
  alfa: number;
  tope: number;
  aging: boolean;
}

export interface CategoriaRegla {
  codigo: string;
  pesoBase: number;
  absoluta: boolean;
}

export interface TurnoRegla {
  id: number | string;
  emitidoMs: number;
  categoria: CategoriaRegla | null;
}

export function pesoEfectivo(c: CategoriaRegla | null | undefined) {
  if (!c) return 0;
  return c.absoluta ? PESO_ABSOLUTO : c.pesoBase;
}

export function esPreferente(c: CategoriaRegla | null | undefined) {
  return !!c && !c.absoluta && c.pesoBase > 0;
}

export function esGeneral(c: CategoriaRegla | null | undefined) {
  return !c || (!c.absoluta && c.pesoBase === 0);
}

export function claveOrden(peso: number, emitidoMs: number, alfa: number, aging: boolean) {
  const minutos = (emitidoMs - ORIGEN_CLAVE_MS) / 60000;
  return peso - (aging ? alfa * minutos : 0);
}

export function claveDe(t: TurnoRegla, cfg: ConfigPrioridad) {
  return claveOrden(pesoEfectivo(t.categoria), t.emitidoMs, cfg.alfa, cfg.aging);
}

/** Comparador: mayor clave primero; desempate por emisión y luego por id. */
export function comparar(cfg: ConfigPrioridad) {
  return (a: TurnoRegla, b: TurnoRegla) => {
    const d = claveDe(b, cfg) - claveDe(a, cfg);
    if (d !== 0) return d;
    if (a.emitidoMs !== b.emitidoMs) return a.emitidoMs - b.emitidoMs;
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  };
}

export function ordenar<T extends TurnoRegla>(turnos: T[], cfg: ConfigPrioridad): T[] {
  return [...turnos].sort(comparar(cfg));
}

/**
 * Selección del siguiente con tope de adelantos (RN-M1-03). Devuelve el elegido y la racha resultante.
 * Es la misma decisión que hace `siguiente_turno()` en SQL; aquí sirve para pruebas y para la vista previa.
 */
export function seleccionarSiguiente<T extends TurnoRegla>(espera: T[], cfg: ConfigPrioridad, racha: number) {
  if (espera.length === 0) return { turno: null as T | null, racha, cortoRacha: false };
  const orden = ordenar(espera, cfg);
  let elegido = orden[0];
  let cortoRacha = false;
  if (cfg.tope > 0 && esPreferente(elegido.categoria) && racha >= cfg.tope) {
    const general = orden.find((t) => esGeneral(t.categoria));
    if (general) {
      elegido = general;
      cortoRacha = true;
    }
  }
  let nueva = racha;
  if (elegido.categoria?.absoluta) nueva = racha;
  else if (esPreferente(elegido.categoria)) nueva = racha + 1;
  else nueva = 0;
  return { turno: elegido, racha: nueva, cortoRacha };
}

/** Orden de llamadas completo (vaciando la cola) aplicando el tope. */
export function secuenciaLlamadas<T extends TurnoRegla>(espera: T[], cfg: ConfigPrioridad, rachaInicial = 0): T[] {
  const pendientes = [...espera];
  const salida: T[] = [];
  let racha = rachaInicial;
  while (pendientes.length) {
    const r = seleccionarSiguiente(pendientes, cfg, racha);
    if (!r.turno) break;
    salida.push(r.turno);
    racha = r.racha;
    pendientes.splice(pendientes.indexOf(r.turno), 1);
  }
  return salida;
}

/** Puntaje visible P(t) = peso + α·minutos de espera (§6.3). */
export function explicarPuntaje(t: TurnoRegla, cfg: ConfigPrioridad, ahoraMs: number) {
  const minEspera = Math.max(0, (ahoraMs - t.emitidoMs) / 60000);
  const base = pesoEfectivo(t.categoria);
  const antiguedad = cfg.aging ? cfg.alfa * minEspera : 0;
  return {
    base,
    antiguedad: Math.round(antiguedad * 10) / 10,
    minEspera: Math.round(minEspera),
    total: Math.round((base + antiguedad) * 10) / 10,
    texto: t.categoria?.absoluta
      ? "Atención inmediata (categoría absoluta)"
      : `${Math.round(base + antiguedad)} pts = ${base} (base${t.categoria ? `, ${t.categoria.codigo}` : ""}) + ${cfg.alfa} × ${Math.round(minEspera)} min`,
  };
}

/** Minutos de antigüedad con que un general iguala a un preferente de peso `w` (Δ = w/α). */
export function minutosParaAlcanzar(peso: number, alfa: number) {
  return alfa > 0 ? peso / alfa : Infinity;
}

export interface TurnoSimulado {
  codigo: string;
  categoria: string;
  esperaMin: number;
}

/** POST /prioridades/simular: orden FIFO vs priorizado de una cola hipotética (RF-M1-09). */
export function simular(turnos: TurnoSimulado[], categorias: CategoriaRegla[], cfg: ConfigPrioridad, ahoraMs = Date.now()) {
  const mapa = new Map(categorias.map((c) => [c.codigo, c]));
  const items: (TurnoRegla & { codigo: string })[] = turnos.map((t, i) => ({
    id: i,
    codigo: t.codigo,
    emitidoMs: ahoraMs - t.esperaMin * 60000,
    categoria: t.categoria === "GENERAL" ? null : (mapa.get(t.categoria) ?? null),
  }));
  const fifo = [...items].sort((a, b) => a.emitidoMs - b.emitidoMs || Number(a.id) - Number(b.id)).map((t) => t.codigo);
  const priorizado = secuenciaLlamadas(items, cfg).map((t) => t.codigo);
  const puntajes = Object.fromEntries(items.map((t) => [t.codigo, explicarPuntaje(t, cfg, ahoraMs).total]));
  return { fifo, priorizado, puntajes };
}
