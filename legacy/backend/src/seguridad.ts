import { log } from "@backend/log";

const POR_DEFECTO = ["turnoya-dev-secret-cambiar-en-produccion-2026", "cambia-este-secreto-en-produccion-32-chars", "0123456789abcdef0123456789abcdef"];

/** F7: en producción la app no arranca con secretos ausentes o de ejemplo. */
export function validarSecretos() {
  const problemas: string[] = [];
  for (const k of ["JWT_SECRET", "DATA_ENCRYPTION_KEY"]) {
    const v = process.env[k];
    if (!v) problemas.push(`${k} no está definida`);
    else if (POR_DEFECTO.includes(v)) problemas.push(`${k} usa el valor de ejemplo`);
    else if (v.length < 32) problemas.push(`${k} es demasiado corta (mínimo 32 caracteres)`);
  }
  if (!problemas.length) return;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_SECRETS !== "true") {
    throw new Error(`Configuración insegura: ${problemas.join("; ")}. Define secretos propios en .env (ver .env.example).`);
  }
  log.warn("secretos de desarrollo", { problemas });
}
