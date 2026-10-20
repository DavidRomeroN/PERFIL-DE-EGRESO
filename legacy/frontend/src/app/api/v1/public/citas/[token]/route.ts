import { error, ok, paramsDe, publico, rateLimit } from "@backend/api";
import { cancelarPorToken, obtenerCita } from "@backend/citas/service";

type P = { params: Promise<{ token: string }> };

/** GET /api/v1/public/citas/:token — estado de la cita (sin datos personales) */
export const GET = publico<P>(async (_req, ctx) => ok(await obtenerCita((await paramsDe(ctx)).token)));

/** DELETE /api/v1/public/citas/:token — cancelar (devuelve el cupo) */
export const DELETE = publico<P>(async (req, ctx) => {
  if (!await rateLimit(req, "cita-cancelar", 10)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  return ok(await cancelarPorToken((await paramsDe(ctx)).token));
});
