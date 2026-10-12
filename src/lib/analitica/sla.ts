/**
 * M7 · SLA con censura a la derecha (RN-M7-01, docs/modulos/M7-analitica-sla.md §6.3). Función pura.
 *
 * - Llamado con espera ≤ máx ⇒ CUMPLE; llamado con espera > máx ⇒ INCUMPLE.
 * - En espera con edad > máx ⇒ ya INCUMPLE aunque no haya sido llamado (antes se ignoraba: D11).
 * - En espera con edad ≤ máx ⇒ PENDIENTE (fuera del denominador; "en riesgo" si edad ≥ 80 % del máx).
 * - Cancelado / no presentado ⇒ cuenta solo si su espera superó el máx.
 */

export type EstadoSla = "CUMPLE" | "INCUMPLE" | "PENDIENTE" | "EXCLUIDO";

export interface TurnoSla {
  estado: string;
  llamado: boolean;
  esperaSeg: number;
}

export function clasificar(t: TurnoSla, maxSeg: number): EstadoSla {
  if (t.llamado) return t.esperaSeg <= maxSeg ? "CUMPLE" : "INCUMPLE";
  if (t.estado === "EMITIDO" || t.estado === "AVISADO") return t.esperaSeg > maxSeg ? "INCUMPLE" : "PENDIENTE";
  if ((t.estado === "CANCELADO" || t.estado === "NO_SE_PRESENTO") && t.esperaSeg > maxSeg) return "INCUMPLE";
  return "EXCLUIDO";
}

export function cumplimientoSla(turnos: TurnoSla[], esperaMaxMin: number, objetivoPct = 90) {
  const maxSeg = esperaMaxMin * 60;
  let cumplen = 0;
  let incumplen = 0;
  let pendientes = 0;
  let enRiesgo = 0;
  for (const t of turnos) {
    const c = clasificar(t, maxSeg);
    if (c === "CUMPLE") cumplen++;
    else if (c === "INCUMPLE") incumplen++;
    else if (c === "PENDIENTE") {
      pendientes++;
      if (t.esperaSeg >= 0.8 * maxSeg) enRiesgo++;
    }
  }
  const n = cumplen + incumplen;
  const cumplimiento = n ? cumplen / n : null;
  const permitidos = (1 - objetivoPct / 100) * n;
  return {
    muestra: n,
    cumplen,
    incumplen,
    pendientes,
    enRiesgo,
    cumplimiento,
    cumple: cumplimiento === null ? null : cumplimiento * 100 >= objetivoPct,
    /** Fracción del presupuesto de error consumida (1 = agotado). */
    presupuestoConsumido: permitidos > 0 ? incumplen / permitidos : incumplen > 0 ? Infinity : 0,
  };
}
