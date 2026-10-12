export interface CargaCola {
  colaId: number;
  enEspera: number;
  ventanillas: number;
}

/** Mueve una ventanilla de la cola más vacía a la más llena si la diferencia supera el umbral. */
export function sugerirMovimiento(cargas: CargaCola[], umbral = 5) {
  if (cargas.length < 2) return null;
  const orden = [...cargas].sort((a, b) => b.enEspera - a.enEspera);
  const llena = orden[0];
  const vacia = orden[orden.length - 1];
  if (vacia.ventanillas < 2) return null;
  if (llena.enEspera - vacia.enEspera < umbral) return null;
  return { desde: vacia.colaId, hacia: llena.colaId, diferencia: llena.enEspera - vacia.enEspera };
}
