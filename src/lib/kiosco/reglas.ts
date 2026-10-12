/**
 * M5 · Reglas puras del kiosco offline-first (docs/modulos/M5-kiosco-offline.md §6). Sirven en el servidor y
 * en el navegador (no importan nada de Node).
 */

// ---------------------------------------------------------------------------
// Servidor: corrección de reloj y clasificación de eventos (§6.4, RN-M5-03/04/07)
// ---------------------------------------------------------------------------

/**
 * emitido = ts_dispositivo + offset, nunca en el futuro y monótono dentro del dispositivo (RN-M5-03).
 * El piso "último heartbeat − 5 s" del diseño no se aplica en el servidor: tras reconectar, el heartbeat ya es
 * posterior a los eventos offline y los adelantaría; la antigüedad máxima la controla `validarEvento`.
 */
export function corregirTiempo(p: { tsDispositivoMs: number; offsetMs: number; ultimoHeartbeatMs: number | null; previoMs: number | null; ahoraMs: number }) {
  let t = Math.min(p.tsDispositivoMs + p.offsetMs, p.ahoraMs);
  if (p.previoMs !== null) t = Math.max(t, p.previoMs + 1);
  return Math.min(t, p.ahoraMs);
}

export type Motivo = "FECHA_ANTERIOR" | "VENTANA_OFFLINE" | "RELOJ_INCONSISTENTE" | "COLA_INACTIVA" | "LIMITE_PLAN" | "COLA_NO_ASIGNADA";

export function validarEvento(p: { fechaEventoISO: string; hoyISO: string; tsCorregidoMs: number; ahoraMs: number; ventanaOfflineHoras: number; offsetAlEmitirMs: number; offsetActualMs: number }): Motivo | null {
  if (p.fechaEventoISO < p.hoyISO) return "FECHA_ANTERIOR";
  if (p.ahoraMs - p.tsCorregidoMs > p.ventanaOfflineHoras * 3600_000) return "VENTANA_OFFLINE";
  if (Math.abs(p.offsetActualMs - p.offsetAlEmitirMs) > 300_000) return "RELOJ_INCONSISTENTE";
  return null;
}

// ---------------------------------------------------------------------------
// Cliente: reloj estilo NTP, backoff, UUID v7, estado de conexión (§6.1, §6.3, §6.5)
// ---------------------------------------------------------------------------

export interface MuestraReloj {
  rtt: number;
  offset: number;
}

/** offset = ts_servidor − (t0 + rtt/2); se usa la muestra de menor RTT entre las últimas 5. */
export function muestraReloj(t0: number, t1: number, tsServidor: number): MuestraReloj {
  const rtt = t1 - t0;
  return { rtt, offset: Math.round(tsServidor - (t0 + rtt / 2)) };
}

export function mejorOffset(muestras: MuestraReloj[]) {
  const ult = muestras.slice(-5);
  if (!ult.length) return 0;
  return ult.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
}

/** Espera antes del próximo intento: min(60 s, 2^intentos s) + jitter de 0–1 s. */
export function backoffMs(intentos: number, aleatorio = Math.random()) {
  return Math.min(60_000, 2 ** Math.max(0, intentos) * 1000) + Math.floor(aleatorio * 1000);
}

/** UUID v7 (ordenable por tiempo): 48 bits de milisegundos + aleatorio. */
export function uuidv7(ahoraMs = Date.now(), bytesAleatorios?: Uint8Array) {
  const b = bytesAleatorios ?? crypto.getRandomValues(new Uint8Array(16));
  const ms = BigInt(ahoraMs);
  const hex = ms.toString(16).padStart(12, "0");
  const r = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const v = `7${r.slice(0, 3)}`;
  const variante = ((parseInt(r.slice(3, 4), 16) & 0x3) | 0x8).toString(16) + r.slice(4, 7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${v}-${variante}-${r.slice(7, 19)}`;
}

export type EstadoConexion = "ONLINE" | "DEGRADADO" | "OFFLINE" | "SINCRONIZANDO";

/** Máquina de estados de conexión (§6.1). */
export function siguienteConexion(e: EstadoConexion, ev: { tipo: "OK"; rtt: number; pendientes: number } | { tipo: "FALLO"; fallosSeguidos: number; desdePrimerFalloMs: number }): EstadoConexion {
  if (ev.tipo === "OK") {
    if (ev.pendientes > 0) return "SINCRONIZANDO";
    return ev.rtt < 2000 ? "ONLINE" : "DEGRADADO";
  }
  if (ev.fallosSeguidos >= 3 || ev.desdePrimerFalloMs >= 60_000) return "OFFLINE";
  return e === "OFFLINE" ? "OFFLINE" : "DEGRADADO";
}

/** Código provisional del ticket offline: K{n}-{seq}. */
export function codigoProvisional(numeroDispositivo: number, seq: number) {
  return `K${numeroDispositivo}-${String(seq).padStart(4, "0")}`;
}
