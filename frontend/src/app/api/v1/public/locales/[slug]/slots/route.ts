import { error, ok, paramsDe, publico, rateLimit } from "@backend/api";
import { slotsDelDia } from "@backend/citas/service";

/** GET /api/v1/public/locales/:slug/slots?colaId&fecha=yyyy-mm-dd (M3) */
export const GET = publico<{ params: Promise<{ slug: string }> }>(async (req, ctx) => {
  if (!await rateLimit(req, "slots", 60)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const { slug } = await paramsDe(ctx);
  const url = new URL(req.url);
  const colaId = Number(url.searchParams.get("colaId"));
  const fecha = url.searchParams.get("fecha") ?? "";
  if (!colaId || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return error("VALIDACION", "Indica la cola y la fecha", 422);
  return ok(await slotsDelDia(slug, colaId, fecha));
});
