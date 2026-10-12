import { z } from "zod";
import { error, ok, paramsDe, parseBody, publico, rateLimit } from "@/lib/api";
import { checkin } from "@/lib/citas/service";

const schema = z.object({ pin: z.string().trim().regex(/^\d{4}$/, "El PIN tiene 4 dígitos") });

/** POST /api/v1/public/citas/:token/checkin — exige el PIN de presencia de la pantalla (RF-M3-09) */
export const POST = publico<{ params: Promise<{ token: string }> }>(async (req, ctx) => {
  if (!await rateLimit(req, "checkin", 10)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const { token } = await paramsDe(ctx);
  const b = await parseBody(req, schema);
  return ok(await checkin(token, { pin: b.pin }));
});
