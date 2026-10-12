import { error, ok, paramsDe, publico, rateLimit } from "@/lib/api";
import { checkInCita } from "@/lib/operacion";

export const POST = publico<{ params: Promise<{ token: string }> }>(async (req, ctx) => {
  if (!rateLimit(req, "checkin", 10)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const { token } = await paramsDe(ctx);
  const body = await req.json().catch(() => ({})) as { pin?: string };
  return ok(await checkInCita(token, body.pin));
});
