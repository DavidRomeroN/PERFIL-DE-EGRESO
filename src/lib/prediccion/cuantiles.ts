/** Cuantil tipo 7 (el de R y Excel). */
export function cuantil(valores: number[], p: number) {
  if (valores.length === 0) return 0;
  const xs = [...valores].sort((a, b) => a - b);
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return xs[lo];
  return xs[lo] * (hi - pos) + xs[hi] * (pos - lo);
}

export function intervaloEspera(muestrasMin: number[]) {
  return { p50: cuantil(muestrasMin, 0.5), p90: cuantil(muestrasMin, 0.9) };
}
