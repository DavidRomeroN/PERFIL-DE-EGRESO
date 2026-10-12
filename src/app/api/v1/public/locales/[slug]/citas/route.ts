import { error, ok, paramsDe, publico, rateLimit } from "@/lib/api";
import { slotsCita } from "@/lib/operacion";

export const GET = publico<{ params: Promise<{ slug: string }> }>(async (req, ctx) => {
  if (!rateLimit(req, "slots", 30)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const { slug } = await paramsDe(ctx);
  const colaId = Number(new URL(req.url).searchParams.get("colaId"));
  if (!colaId) return error("VALIDACION", "Falta la cola", 422);
  return ok(await slotsCita(slug, colaId));
});
