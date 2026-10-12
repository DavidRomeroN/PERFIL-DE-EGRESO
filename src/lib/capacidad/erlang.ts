/** Erlang C numéricamente estable (recurrencia de Erlang B). */
export function erlangC(llegadasPorHora: number, servicioMin: number, servidores: number) {
  const mu = 60 / Math.max(servicioMin, 1);
  const a = llegadasPorHora / mu;
  const c = Math.max(1, Math.floor(servidores));
  if (c <= a) return { estable: false, probabilidadEspera: 1, esperaMin: null as number | null, ocupacion: a / c };
  let b = 1;
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  const pw = (c * b) / (c - a * (1 - b));
  const esperaMin = (pw / (c * mu - llegadasPorHora)) * 60;
  return { estable: true, probabilidadEspera: pw, esperaMin, ocupacion: a / c };
}

export function minimoServidores(llegadasPorHora: number, servicioMin: number, esperaObjetivoMin: number) {
  const mu = 60 / Math.max(servicioMin, 1);
  let c = Math.floor(llegadasPorHora / mu) + 1;
  for (let i = 0; i < 40; i++) {
    const r = erlangC(llegadasPorHora, servicioMin, c);
    if (r.estable && (r.esperaMin ?? Infinity) <= esperaObjetivoMin) return c;
    c++;
  }
  return c;
}
