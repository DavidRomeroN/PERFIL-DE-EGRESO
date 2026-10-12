/** Porcentaje de turnos atendidos dentro del objetivo. Los que siguen en espera no cuentan como incumplimiento (censura). */
export function cumplimientoSla(turnos: { esperaMin: number | null; cerrado: boolean }[], objetivoMin: number) {
  const cerrados = turnos.filter((t) => t.cerrado && t.esperaMin != null);
  if (cerrados.length === 0) return { muestra: 0, cumplimiento: 1 };
  const ok = cerrados.filter((t) => (t.esperaMin ?? 0) <= objetivoMin).length;
  return { muestra: cerrados.length, cumplimiento: ok / cerrados.length };
}
