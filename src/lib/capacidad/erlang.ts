/**
 * M8 · Modelo analítico M/M/c (Erlang C) numéricamente estable (docs/modulos/M8-simulador-capacidad.md §6.1).
 * Tiempos en minutos y tasas en clientes/minuto internamente (RN-M8-02); la UI usa clientes/hora.
 */

/** Recursión de Erlang B: B_0 = 1, B_k = a·B_{k−1} / (k + a·B_{k−1}). Estable hasta c = 200 y más. */
export function erlangB(a: number, c: number) {
  let b = 1;
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  return b;
}

/** C(c, a) = B_c / (1 − ρ(1 − B_c)), válido si ρ < 1. */
export function probEspera(a: number, c: number) {
  const rho = a / c;
  if (rho >= 1) return 1;
  const b = erlangB(a, c);
  return b / (1 - rho * (1 - b));
}

export interface ResultadoErlang {
  estable: boolean;
  /** Utilización ρ = a / c */
  ocupacion: number;
  probabilidadEspera: number;
  /** Espera media en cola Wq (min) */
  esperaMin: number | null;
  /** Tiempo en el sistema W (min) */
  sistemaMin: number | null;
  /** Largo medio de la cola Lq */
  colaMedia: number | null;
}

/** Compatibilidad: `erlangC(llegadasPorHora, servicioMin, servidores)`. */
export function erlangC(llegadasPorHora: number, servicioMin: number, servidores: number): ResultadoErlang {
  const lambda = llegadasPorHora / 60;
  const mu = 1 / Math.max(servicioMin, 1e-9);
  const c = Math.max(1, Math.floor(servidores));
  const a = lambda / mu;
  if (a >= c) return { estable: false, ocupacion: a / c, probabilidadEspera: 1, esperaMin: null, sistemaMin: null, colaMedia: null };
  const C = probEspera(a, c);
  const wq = C / (c * mu - lambda);
  return { estable: true, ocupacion: a / c, probabilidadEspera: C, esperaMin: wq, sistemaMin: wq + 1 / mu, colaMedia: lambda * wq };
}

/** P(Wq > t) = C·exp(−(cμ − λ)·t). */
export function probEsperaMayor(llegadasPorHora: number, servicioMin: number, servidores: number, tMin: number) {
  const lambda = llegadasPorHora / 60;
  const mu = 1 / servicioMin;
  const c = Math.max(1, Math.floor(servidores));
  if (lambda >= c * mu) return 1;
  return probEspera(lambda / mu, c) * Math.exp(-(c * mu - lambda) * tMin);
}

/** Nivel de servicio SL(t) = 1 − P(Wq > t). */
export function nivelServicio(llegadasPorHora: number, servicioMin: number, servidores: number, tMin: number) {
  return 1 - probEsperaMayor(llegadasPorHora, servicioMin, servidores, tMin);
}

/** Percentil q de la espera: t_q = max(0, ln(C/(1−q)) / (cμ − λ)). */
export function percentilEspera(llegadasPorHora: number, servicioMin: number, servidores: number, q: number) {
  const lambda = llegadasPorHora / 60;
  const mu = 1 / servicioMin;
  const c = Math.max(1, Math.floor(servidores));
  if (lambda >= c * mu) return Infinity;
  const C = probEspera(lambda / mu, c);
  return Math.max(0, Math.log(C / (1 - q)) / (c * mu - lambda));
}

/**
 * Mínimo de ventanillas que cumple el SLA: SL(t) ≥ objetivo **y** ρ ≤ ρ_max (RF-M8-04).
 * Compatibilidad: si solo se pasa `esperaObjetivoMin`, busca la que deja la espera media bajo ese valor.
 */
export function minimoServidores(llegadasPorHora: number, servicioMin: number, esperaObjetivoMin: number, objetivo?: number, rhoMax = 0.85, tope = 200) {
  const a = llegadasPorHora / 60 / (1 / servicioMin);
  for (let c = Math.max(1, Math.floor(a) + 1); c <= tope; c++) {
    const r = erlangC(llegadasPorHora, servicioMin, c);
    if (!r.estable) continue;
    if (objetivo === undefined) {
      if ((r.esperaMin ?? Infinity) <= esperaObjetivoMin) return c;
    } else if (nivelServicio(llegadasPorHora, servicioMin, c, esperaObjetivoMin) >= objetivo && r.ocupacion <= rhoMax) return c;
  }
  return tope;
}

/** Tabla de comparación c = desde…hasta (pantalla "Comparar"). */
export function tablaServidores(llegadasPorHora: number, servicioMin: number, slaMin: number, desde: number, hasta: number) {
  const filas = [];
  for (let c = desde; c <= hasta; c++) {
    const r = erlangC(llegadasPorHora, servicioMin, c);
    filas.push({
      c,
      ocupacion: r.ocupacion,
      estable: r.estable,
      probEspera: r.probabilidadEspera,
      esperaMin: r.esperaMin,
      p90Min: r.estable ? percentilEspera(llegadasPorHora, servicioMin, c, 0.9) : null,
      nivelServicio: r.estable ? nivelServicio(llegadasPorHora, servicioMin, c, slaMin) : 0,
    });
  }
  return filas;
}
