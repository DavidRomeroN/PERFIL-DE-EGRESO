import { auditar, conRol, error, ok, paramsDe } from "@backend/api";
import { ejecutarJob, jobsDefinidos } from "@backend/jobs/scheduler";

/** POST /api/v1/jobs/:nombre — ejecutar un job ahora */
export const POST = conRol<{ params: Promise<{ nombre: string }> }>(["SUPER_ADMIN"], async (_req, ctx) => {
  const { nombre } = await paramsDe(ctx);
  const def = jobsDefinidos().find((j) => j.nombre === nombre);
  if (!def) return error("NO_ENCONTRADO", "El job no existe", 404);
  await auditar(ctx, { localId: null, accion: "JOB_EJECUTAR", entidad: "job", entidadId: nombre, humana: `Ejecutó el job ${nombre}` });
  return ok(await ejecutarJob(def));
});
