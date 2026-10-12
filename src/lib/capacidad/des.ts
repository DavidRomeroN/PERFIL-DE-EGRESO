/**
 * M8 · Simulación de eventos discretos + Monte Carlo (docs/modulos/M8-simulador-capacidad.md §6.2–6.7).
 * Puro y sin dependencias: corre igual en el servidor, en pruebas y en el Web Worker del navegador.
 */

// ---------------------------------------------------------------------------
// PRNG por flujos (mulberry32 + SplitMix32) ⇒ reproducible y con números aleatorios comunes (CRN)
// ---------------------------------------------------------------------------
export function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** seed_i = hash32(semillaBase, réplica, flujo) (SplitMix32). */
export function semillaFlujo(base: number, replica: number, flujo: number) {
  let z = (base ^ Math.imul(replica + 1, 0x9e3779b9) ^ Math.imul(flujo + 1, 0x85ebca6b)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

export const FLUJOS = { LLEGADAS: 0, SERVICIO: 1, PACIENCIA: 2, NOSHOW: 3, ACEPTACION: 4 } as const;

export function exponencial(u: () => number, media: number) {
  return -Math.log(1 - u()) * media;
}

/** Normal estándar por Box–Muller. */
export function normal(u: () => number) {
  const u1 = Math.max(u(), 1e-12);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u());
}

/** Log-normal con media y CV dados: σ² = ln(1 + cv²), μ = ln(media) − σ²/2. */
export function logNormal(u: () => number, media: number, cv: number) {
  const s2 = Math.log(1 + cv * cv);
  return Math.exp(Math.log(media) - s2 / 2 + Math.sqrt(s2) * normal(u));
}

/** Ajuste log-normal por máxima verosimilitud (media y desviación de ln x). */
export function ajustarLogNormal(xs: number[]) {
  const ls = xs.filter((x) => x > 0).map(Math.log);
  const mu = ls.reduce((a, b) => a + b, 0) / Math.max(1, ls.length);
  const s2 = ls.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, ls.length);
  const media = Math.exp(mu + s2 / 2);
  return { mu, sigma: Math.sqrt(s2), media, cv: Math.sqrt(Math.exp(s2) - 1) };
}

// ---------------------------------------------------------------------------
// Montículo binario de eventos (tiempo, seq) — empates resueltos por orden de inserción
// ---------------------------------------------------------------------------
export class Monticulo<T extends { t: number; seq: number }> {
  private h: T[] = [];
  get tamano() {
    return this.h.length;
  }
  private menor(i: number, j: number) {
    return this.h[i].t < this.h[j].t || (this.h[i].t === this.h[j].t && this.h[i].seq < this.h[j].seq);
  }
  push(x: T) {
    const h = this.h;
    h.push(x);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.menor(i, p)) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    const h = this.h;
    if (!h.length) return undefined;
    const top = h[0];
    const ult = h.pop()!;
    if (h.length) {
      h[0] = ult;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.menor(l, m)) m = l;
        if (r < h.length && this.menor(r, m)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------------------
// Parámetros (JSON versionado §5.1)
// ---------------------------------------------------------------------------
export interface Tramo<T> {
  desde: string;
  valor: T;
}

export interface ParametrosSim {
  version: 1;
  modo: "DIA" | "ESTACIONARIO";
  horario: { apertura: string; cierre: string };
  lambdaPorHora: { desde: string; valor: number }[];
  servicio: { tipo: "EXPONENCIAL" | "LOGNORMAL" | "EMPIRICA"; mediaMin: number; cv?: number; muestras?: number[] };
  ventanillas: { desde: string; c: number }[];
  pacienciaMin?: { tipo: "EXPONENCIAL"; media: number } | null;
  noShow?: { p: number; minutos: number } | null;
  sla: { esperaMaxMin: number; objetivoPct: number };
  costos?: { ventanillaHora: number; esperaMinuto: number } | null;
  replicas: number;
  semilla: number;
}

const aMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Función escalonada a partir de tramos ordenados por `desde` (minutos desde la apertura). */
function escalones<T>(tramos: { desde: string; v: T }[], apertura: number, defecto: T) {
  const t = tramos.map((x) => ({ m: aMin(x.desde) - apertura, v: x.v })).sort((a, b) => a.m - b.m);
  return (min: number) => {
    let v = t.length ? t[0].v : defecto;
    for (const x of t) if (x.m <= min) v = x.v;
    return v;
  };
}

export interface ResultadoReplica {
  esperaMedia: number;
  esperaP90: number;
  pctSla: number;
  utilizacion: number;
  colaMax: number;
  colaMedia: number;
  abandonoPct: number;
  noShows: number;
  atendidos: number;
  llegadas: number;
  backlog: number;
  costo: number;
  esperas: number[];
}

/** Una réplica del DES (§6.2). */
export function simularReplica(p: ParametrosSim, replica: number): ResultadoReplica {
  const ap = aMin(p.horario.apertura);
  const duracion = Math.max(1, aMin(p.horario.cierre) - ap);
  const u = {
    llegadas: mulberry32(semillaFlujo(p.semilla, replica, FLUJOS.LLEGADAS)),
    servicio: mulberry32(semillaFlujo(p.semilla, replica, FLUJOS.SERVICIO)),
    paciencia: mulberry32(semillaFlujo(p.semilla, replica, FLUJOS.PACIENCIA)),
    noshow: mulberry32(semillaFlujo(p.semilla, replica, FLUJOS.NOSHOW)),
    acept: mulberry32(semillaFlujo(p.semilla, replica, FLUJOS.ACEPTACION)),
  };
  const lambda = escalones(p.lambdaPorHora.map((x) => ({ desde: x.desde, v: x.valor / 60 })), ap, 0);
  const cDe = escalones(p.ventanillas.map((x) => ({ desde: x.desde, v: Math.max(0, Math.floor(x.c)) })), ap, 1);
  const lambdaMax = Math.max(1e-9, ...p.lambdaPorHora.map((x) => x.valor / 60));
  const muestras = p.servicio.muestras?.filter((x) => x > 0) ?? [];
  const servicio = () =>
    p.servicio.tipo === "EXPONENCIAL" ? exponencial(u.servicio, p.servicio.mediaMin)
    : p.servicio.tipo === "LOGNORMAL" ? logNormal(u.servicio, p.servicio.mediaMin, p.servicio.cv ?? 0.6)
    : muestras.length ? muestras[Math.floor(u.servicio() * muestras.length)] : exponencial(u.servicio, p.servicio.mediaMin);

  type Ev = { t: number; seq: number; tipo: "LLEGADA" | "FIN" | "ABANDONO" | "CAMBIO_C"; cliente?: number; servidor?: number };
  const heap = new Monticulo<Ev>();
  let seq = 0;
  const push = (e: Omit<Ev, "seq">) => heap.push({ ...e, seq: seq++ });

  // Llegadas no homogéneas por adelgazamiento (Lewis–Shedler)
  const siguienteLlegada = (desde: number) => {
    let t = desde;
    for (;;) {
      t += exponencial(u.llegadas, 1 / lambdaMax);
      if (t >= duracion) return null;
      if (u.acept() <= lambda(t) / lambdaMax) return t;
    }
  };
  const t0 = siguienteLlegada(0);
  if (t0 !== null) push({ t: t0, tipo: "LLEGADA" });
  for (const tr of p.ventanillas) {
    const m = aMin(tr.desde) - ap;
    if (m > 0 && m < duracion) push({ t: m, tipo: "CAMBIO_C" });
  }

  const llegada: number[] = [];
  const enCola: number[] = []; // FIFO de ids de cliente
  const quitado = new Set<number>();
  let cObjetivo = cDe(0);
  const ocupado: boolean[] = Array(Math.max(cObjetivo, ...p.ventanillas.map((v) => v.c), 1)).fill(false);
  let abiertas = cObjetivo;
  const esperas: number[] = [];
  let abandonos = 0;
  let noShows = 0;
  let atendidos = 0;
  let tiempoOcupado = 0;
  let tiempoDisponible = 0;
  let colaMax = 0;
  let areaCola = 0;
  let ultimo = 0;
  const avanzarReloj = (t: number) => {
    const dt = t - ultimo;
    areaCola += (enCola.length - quitado.size > 0 ? enCola.filter((x) => !quitado.has(x)).length : 0) * dt;
    tiempoOcupado += ocupado.filter(Boolean).length * dt;
    tiempoDisponible += Math.max(abiertas, ocupado.filter(Boolean).length) * dt;
    ultimo = t;
  };

  const iniciar = (servidor: number, cliente: number, t: number) => {
    ocupado[servidor] = true;
    const espera = t - llegada[cliente];
    // RN-M8-05: con prob. pNS el llamado no se presenta y la ventanilla pierde tNS minutos
    if (p.noShow && u.noshow() < p.noShow.p) {
      noShows++;
      push({ t: t + p.noShow.minutos, tipo: "FIN", servidor });
      return;
    }
    esperas.push(espera);
    push({ t: t + servicio(), tipo: "FIN", servidor });
  };
  const tomarSiguiente = (servidor: number, t: number) => {
    while (enCola.length) {
      const cl = enCola.shift()!;
      if (quitado.has(cl)) {
        quitado.delete(cl);
        continue;
      }
      iniciar(servidor, cl, t);
      return true;
    }
    return false;
  };
  const libre = () => {
    for (let i = 0; i < abiertas; i++) if (!ocupado[i]) return i;
    return -1;
  };

  const limite = duracion + 8 * 60; // drenaje: se atiende a quien quedó al cierre
  for (let e = heap.pop(); e && e.t <= limite; e = heap.pop()) {
    avanzarReloj(e.t);
    if (e.tipo === "LLEGADA") {
      const id = llegada.length;
      llegada.push(e.t);
      const sig = siguienteLlegada(e.t);
      if (sig !== null) push({ t: sig, tipo: "LLEGADA" });
      const s = libre();
      if (s >= 0) iniciar(s, id, e.t);
      else {
        enCola.push(id);
        colaMax = Math.max(colaMax, enCola.length - quitado.size);
        if (p.pacienciaMin) push({ t: e.t + exponencial(u.paciencia, p.pacienciaMin.media), tipo: "ABANDONO", cliente: id });
      }
    } else if (e.tipo === "FIN") {
      atendidos++;
      ocupado[e.servidor!] = false;
      // RN-M8-06: una ventanilla que debe cerrar termina su atención y luego cierra
      if (e.servidor! < abiertas) tomarSiguiente(e.servidor!, e.t);
    } else if (e.tipo === "ABANDONO") {
      const idx = enCola.indexOf(e.cliente!);
      if (idx >= 0 && !quitado.has(e.cliente!)) {
        quitado.add(e.cliente!);
        abandonos++;
      }
    } else if (e.tipo === "CAMBIO_C") {
      cObjetivo = cDe(e.t);
      while (ocupado.length < cObjetivo) ocupado.push(false);
      abiertas = cObjetivo;
      for (let i = 0; i < abiertas; i++) if (!ocupado[i]) tomarSiguiente(i, e.t);
    }
    if (e.t >= duracion && abiertas === 0) break;
  }
  atendidos -= noShows;
  const backlog = enCola.filter((x) => !quitado.has(x)).length;
  const ord = [...esperas].sort((a, b) => a - b);
  const p90 = ord.length ? ord[Math.min(ord.length - 1, Math.floor(0.9 * (ord.length - 1)))] : 0;
  const totalEspera = esperas.reduce((a, b) => a + b, 0);
  const costo = p.costos ? p.ventanillas.reduce((acc, v, i) => {
    const desde = Math.max(0, aMin(v.desde) - ap);
    const hasta = i + 1 < p.ventanillas.length ? aMin(p.ventanillas[i + 1].desde) - ap : duracion;
    return acc + v.c * p.costos!.ventanillaHora * Math.max(0, hasta - desde) / 60;
  }, 0) + totalEspera * p.costos.esperaMinuto : 0;
  return {
    esperaMedia: esperas.length ? totalEspera / esperas.length : 0,
    esperaP90: p90,
    pctSla: esperas.length ? esperas.filter((w) => w <= p.sla.esperaMaxMin).length / esperas.length : 1,
    utilizacion: tiempoDisponible > 0 ? tiempoOcupado / tiempoDisponible : 0,
    colaMax,
    colaMedia: ultimo > 0 ? areaCola / ultimo : 0,
    abandonoPct: llegada.length ? abandonos / llegada.length : 0,
    noShows,
    atendidos,
    llegadas: llegada.length,
    backlog,
    costo,
    esperas,
  };
}

// ---------------------------------------------------------------------------
// Monte Carlo e intervalos de confianza (§6.3)
// ---------------------------------------------------------------------------
const T975: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 15: 2.131, 20: 2.086, 25: 2.06, 29: 2.045 };
export function tStudent975(gl: number) {
  if (gl >= 30) return 1.96;
  const claves = Object.keys(T975).map(Number).filter((k) => k <= gl);
  return T975[Math.max(...claves, 1)];
}

export interface Resumen {
  media: number;
  desv: number;
  ic: [number, number];
}

export function resumir(xs: number[]): Resumen {
  const n = xs.length;
  if (!n) return { media: 0, desv: 0, ic: [0, 0] };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const d = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  const h = n > 1 ? (tStudent975(n - 1) * d) / Math.sqrt(n) : 0;
  return { media: m, desv: d, ic: [m - h, m + h] };
}

export interface ResultadoMonteCarlo {
  replicas: number;
  semilla: number;
  esperaMedia: Resumen;
  esperaP90: Resumen;
  pctSla: Resumen;
  utilizacion: Resumen;
  colaMax: Resumen;
  abandonoPct: Resumen;
  backlog: Resumen;
  costo: Resumen;
  cumpleSla: boolean;
  histograma: { min: number; n: number }[];
  porReplica: { esperaMedia: number; pctSla: number; utilizacion: number; costo: number }[];
}

export function monteCarlo(p: ParametrosSim, opciones: { alProgreso?: (pct: number) => void; cancelado?: () => boolean } = {}): ResultadoMonteCarlo | null {
  const R = Math.min(5000, Math.max(1, Math.floor(p.replicas)));
  const res: ResultadoReplica[] = [];
  const hist = new Array(61).fill(0);
  for (let r = 0; r < R; r++) {
    if (opciones.cancelado?.()) return null;
    const x = simularReplica(p, r);
    for (const w of x.esperas) hist[Math.min(60, Math.floor(w))]++;
    x.esperas = [];
    res.push(x);
    if (opciones.alProgreso && (r + 1) % Math.max(1, Math.floor(R / 20)) === 0) opciones.alProgreso(Math.round(((r + 1) / R) * 100));
  }
  const col = (k: keyof ResultadoReplica) => res.map((x) => x[k] as number);
  const sla = resumir(col("pctSla"));
  return {
    replicas: R,
    semilla: p.semilla,
    esperaMedia: resumir(col("esperaMedia")),
    esperaP90: resumir(col("esperaP90")),
    pctSla: sla,
    utilizacion: resumir(col("utilizacion")),
    colaMax: resumir(col("colaMax")),
    abandonoPct: resumir(col("abandonoPct")),
    backlog: resumir(col("backlog")),
    costo: resumir(col("costo")),
    cumpleSla: sla.media * 100 >= p.sla.objetivoPct,
    histograma: hist.map((n, min) => ({ min, n })),
    porReplica: res.map((x) => ({ esperaMedia: x.esperaMedia, pctSla: x.pctSla, utilizacion: x.utilizacion, costo: x.costo })),
  };
}

/** Comparación pareada con CRN: misma semilla ⇒ mismas llegadas y servicios en A y B (§6.3). */
export function compararPareado(a: ParametrosSim, b: ParametrosSim, metrica: "pctSla" | "esperaMedia" | "costo" = "pctSla") {
  const R = Math.min(a.replicas, b.replicas);
  const d: number[] = [];
  for (let r = 0; r < R; r++) d.push(simularReplica({ ...b, semilla: a.semilla }, r)[metrica] - simularReplica(a, r)[metrica]);
  return resumir(d);
}

/** Sensibilidad (tornado, §6.6): ΔSL respecto del caso base para cada factor, con CRN. */
export function tornado(p: ParametrosSim, replicas = 200) {
  const base = { ...p, replicas };
  const sl = (q: ParametrosSim) => resumir(Array.from({ length: q.replicas }, (_, r) => simularReplica(q, r).pctSla)).media;
  const ref = sl(base);
  const escala = (f: number) => ({ ...base, lambdaPorHora: base.lambdaPorHora.map((x) => ({ ...x, valor: x.valor * f })) });
  const serv = (f: number) => ({ ...base, servicio: { ...base.servicio, mediaMin: base.servicio.mediaMin * f, muestras: base.servicio.muestras?.map((m) => m * f) } });
  const cc = (d: number) => ({ ...base, ventanillas: base.ventanillas.map((v) => ({ ...v, c: Math.max(1, v.c + d) })) });
  const factores: [string, ParametrosSim][] = [
    ["Llegadas −20 %", escala(0.8)],
    ["Llegadas +20 %", escala(1.2)],
    ["Servicio −20 %", serv(0.8)],
    ["Servicio +20 %", serv(1.2)],
    ["Ventanillas −1", cc(-1)],
    ["Ventanillas +1", cc(1)],
  ];
  return factores.map(([factor, q]) => ({ factor, deltaSl: sl(q) - ref })).sort((x, y) => Math.abs(y.deltaSl) - Math.abs(x.deltaSl));
}

export const VERSION_MOTOR = "des-1.0";

/** Compatibilidad con la versión anterior (`simularCola`): M/M/c constante. */
export function simularCola(opts: { llegadasPorHora: number; servicioMin: number; servidores: number; horas: number; replicas: number; pacienciaMin?: number; semilla?: number }) {
  const cierreMin = 8 * 60 + Math.round(opts.horas * 60);
  const p: ParametrosSim = {
    version: 1,
    modo: "DIA",
    horario: { apertura: "08:00", cierre: `${String(Math.floor(cierreMin / 60)).padStart(2, "0")}:${String(cierreMin % 60).padStart(2, "0")}` },
    lambdaPorHora: [{ desde: "08:00", valor: opts.llegadasPorHora }],
    servicio: { tipo: "EXPONENCIAL", mediaMin: opts.servicioMin },
    ventanillas: [{ desde: "08:00", c: opts.servidores }],
    pacienciaMin: opts.pacienciaMin ? { tipo: "EXPONENCIAL", media: opts.pacienciaMin } : null,
    sla: { esperaMaxMin: 15, objetivoPct: 90 },
    replicas: opts.replicas,
    semilla: opts.semilla ?? 1,
  };
  const r = monteCarlo(p)!;
  return { replicas: r.replicas, esperaMediaMin: r.esperaMedia.media, esperaP90Min: r.esperaP90.media, abandono: r.abandonoPct.media, atendidos: Math.round(r.porReplica.length) };
}
