import { error, ok, paramsDe, publico, rateLimit } from "@/lib/api";
import { confirmar } from "@/lib/citas/service";

/** POST /api/v1/public/citas/:token/confirmar — RESERVADA → CONFIRMADA */
export const POST = publico<{ params: Promise<{ token: string }> }>(async (req, ctx) => {
  if (!await rateLimit(req, "cita-confirmar", 10)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  return ok(await confirmar((await paramsDe(ctx)).token));
});
