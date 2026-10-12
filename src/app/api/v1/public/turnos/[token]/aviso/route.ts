import { z } from "zod";
import { error, ok, paramsDe, parseBody, publico, rateLimit } from "@/lib/api";
import { configurarAviso } from "@/lib/prediccion/service";

const schema = z.object({ minAntes: z.union([z.literal(5), z.literal(10), z.literal(15), z.null()]) });

/** PATCH /api/v1/public/turnos/:token/aviso — "avisarme X min antes" (RF-M2-07, opt-in) */
export const PATCH = publico<{ params: Promise<{ token: string }> }>(async (req, ctx) => {
  if (!await rateLimit(req, "aviso", 10)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const { token } = await paramsDe(ctx);
  const b = await parseBody(req, schema);
  return ok(await configurarAviso(token, b.minAntes));
});
