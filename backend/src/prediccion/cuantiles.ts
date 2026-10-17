/** Utilidades estadísticas puras (M2 §6, M7 §6.1). */

/** Cuantil tipo 7 (interpolación lineal; el de R, Excel y `percentile_cont`). */
export function cuantil(valores: number[], p: number) {
  if (valores.length === 0) return 0;
  const xs = [...valores].sort((a, b) => a - b);
  return cuantilOrdenado(xs, p);
}

export function cuantilOrdenado(xs: number[], p: number) {
  if (xs.length === 0) return 0;
  const pos = (xs.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return xs[lo];
  return xs[lo] * (hi - pos) + xs[hi] * (pos - lo);
}

export function mediana(valores: number[]) {
  return cuantil(valores, 0.5);
}

export function media(valores: number[]) {
  return valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : 0;
}

/** Acota los valores al percentil `p` superior (RN-M2-03 usa 0.99). */
export function winsorizar(valores: number[], p = 0.99) {
  if (valores.length < 3) return [...valores];
  const tope = cuantil(valores, p);
  return valores.map((v) => Math.min(v, tope));
}

/** Desviación absoluta mediana. */
export function mad(valores: number[]) {
  const m = mediana(valores);
  return mediana(valores.map((v) => Math.abs(v - m)));
}

/** PRNG mulberry32 (rápido, 32 bits) con semilla: reproducible. */
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

/** Barajado Fisher–Yates con un generador dado. */
export function barajar<T>(xs: T[], rng: () => number) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function intervaloEspera(muestrasMin: number[]) {
  return { p50: cuantil(muestrasMin, 0.5), p90: cuantil(muestrasMin, 0.9) };
}
