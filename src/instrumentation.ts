/**
 * Arranque del servidor (Next 16 `instrumentation`): validación de secretos (F7) y planificador de jobs (F1).
 * `ENABLE_JOBS=false` desactiva los jobs (p. ej. en una segunda instancia o en pruebas).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validarSecretos } = await import("@/lib/seguridad");
  validarSecretos();
  if (process.env.ENABLE_JOBS === "false") return;
  const { registrarJobs } = await import("@/lib/jobs/registro");
  const { iniciarScheduler } = await import("@/lib/jobs/scheduler");
  registrarJobs();
  iniciarScheduler();
}
