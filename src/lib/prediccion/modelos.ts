export interface Ajuste {
  nombre: "BASELINE" | "EMA" | "ESTACIONAL";
  predecir: (hora: number) => number;
  error: number;
}

function mae(real: number[], pred: number[]) {
  if (real.length === 0) return Infinity;
  return real.reduce((s, y, i) => s + Math.abs(y - pred[i]), 0) / real.length;
}

/** Tres modelos. Gana el de menor error absoluto medio sobre el mismo lote. */
export function ajustarModelos(muestras: { hora: number; esperaMin: number }[]): Ajuste {
  const ys = muestras.map((m) => m.esperaMin);
  const media = ys.length ? ys.reduce((s, y) => s + y, 0) / ys.length : 8;
  const baseline = ys.map(() => media);
  let ema = media;
  const predEma = ys.map((y) => {
    const p = ema;
    ema = ema * 0.7 + y * 0.3;
    return p;
  });
  const porHora = new Map<number, number[]>();
  for (const m of muestras) porHora.set(m.hora, [...(porHora.get(m.hora) ?? []), m.esperaMin]);
  const estacional = (hora: number) => {
    const xs = porHora.get(hora) ?? [];
    if (xs.length < 3) return media;
    const local = xs.reduce((s, x) => s + x, 0) / xs.length;
    const k = 10;
    return (local * xs.length + media * k) / (xs.length + k);
  };
  const predEst = muestras.map((m) => estacional(m.hora));
  const opciones: Ajuste[] = [
    { nombre: "BASELINE", predecir: () => media, error: mae(ys, baseline) },
    { nombre: "EMA", predecir: () => ema, error: mae(ys, predEma) },
    { nombre: "ESTACIONAL", predecir: estacional, error: mae(ys, predEst) },
  ];
  return opciones.sort((a, b) => a.error - b.error)[0];
}
