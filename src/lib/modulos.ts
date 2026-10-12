/** Banderas por plan. Gratis conserva el comportamiento original (sin prioridades ni predicción). */
const POR_PLAN: Record<string, string[]> = {
  GRATIS: [],
  EMPRENDE: ["M1", "M3", "M4", "M6"],
  PRO: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"],
};

export function moduloActivo(planCodigo: string, modulo: string) {
  return (POR_PLAN[planCodigo] ?? []).includes(modulo);
}
