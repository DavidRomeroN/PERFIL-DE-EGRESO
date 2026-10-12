/**
 * F6 · Logger JSON único. Cada línea lleva `request_id`, `local_id`, `usuario_id` y `modulo` cuando se conocen.
 * Nunca registrar teléfonos, nombres ni textos del bot (Ley 29733).
 */
type Nivel = "debug" | "info" | "warn" | "error";
export type CamposLog = { request_id?: string; local_id?: number | null; usuario_id?: number | null; modulo?: string; [k: string]: unknown };

const ORDEN: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minimo = (process.env.LOG_LEVEL as Nivel | undefined) ?? (process.env.NODE_ENV === "test" ? "warn" : "info");

function escribir(nivel: Nivel, msg: string, campos: CamposLog = {}) {
  if (ORDEN[nivel] < (ORDEN[minimo] ?? 20)) return;
  const linea = JSON.stringify({ level: nivel, msg, at: new Date().toISOString(), ...campos });
  if (nivel === "error") console.error(linea);
  else if (nivel === "warn") console.warn(linea);
  else console.log(linea);
}

export const log = {
  debug: (msg: string, c?: CamposLog) => escribir("debug", msg, c),
  info: (msg: string, c?: CamposLog) => escribir("info", msg, c),
  warn: (msg: string, c?: CamposLog) => escribir("warn", msg, c),
  error: (msg: string, c?: CamposLog) => escribir("error", msg, c),
};
