/**
 * F6 · Métricas internas en memoria (contadores e histogramas simples) expuestas en `/api/metrics`
 * con formato de texto de Prometheus. Son por proceso: suficiente para la demo de una instancia.
 */
type Etiquetas = Record<string, string | number>;

const g = globalThis as unknown as { turnoyaMetricas?: { contadores: Map<string, number>; histos: Map<string, number[]> } };
const estado = g.turnoyaMetricas ?? { contadores: new Map<string, number>(), histos: new Map<string, number[]>() };
g.turnoyaMetricas = estado;

function clave(nombre: string, etiquetas?: Etiquetas) {
  if (!etiquetas || Object.keys(etiquetas).length === 0) return nombre;
  const e = Object.entries(etiquetas).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${String(v).replace(/"/g, "'")}"`).join(",");
  return `${nombre}{${e}}`;
}

export function contar(nombre: string, etiquetas?: Etiquetas, n = 1) {
  const k = clave(nombre, etiquetas);
  estado.contadores.set(k, (estado.contadores.get(k) ?? 0) + n);
}

export function observar(nombre: string, valor: number, etiquetas?: Etiquetas) {
  const k = clave(nombre, etiquetas);
  const xs = estado.histos.get(k) ?? [];
  xs.push(valor);
  if (xs.length > 1000) xs.shift();
  estado.histos.set(k, xs);
}

export async function medir<T>(nombre: string, fn: () => Promise<T>, etiquetas?: Etiquetas): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    observar(nombre, performance.now() - t0, etiquetas);
  }
}

function cuantilOrdenado(xs: number[], p: number) {
  if (!xs.length) return 0;
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

export function exportarPrometheus() {
  const lineas: string[] = [];
  for (const [k, v] of estado.contadores) lineas.push(`${k} ${v}`);
  for (const [k, xs] of estado.histos) {
    const ord = [...xs].sort((a, b) => a - b);
    const base = k.includes("{") ? k.slice(0, k.indexOf("{")) : k;
    const etiq = k.includes("{") ? k.slice(k.indexOf("{") + 1, -1) : "";
    const con = (extra: string) => `${base}{${[etiq, extra].filter(Boolean).join(",")}}`;
    lineas.push(`${con('quantile="0.5"')} ${cuantilOrdenado(ord, 0.5).toFixed(2)}`);
    lineas.push(`${con('quantile="0.95"')} ${cuantilOrdenado(ord, 0.95).toFixed(2)}`);
    lineas.push(`${base}_count${etiq ? `{${etiq}}` : ""} ${ord.length}`);
  }
  return lineas.sort().join("\n") + "\n";
}
