import { error, ok, paramsDe, publico, rateLimit } from "@/lib/api";
import { disponibilidad } from "@/lib/citas/service";

/** GET /api/v1/public/locales/:slug/disponibilidad?colaId&dias=14 (M3) */
export const GET = publico<{ params: Promise<{ slug: string }> }>(async (req, ctx) => {
  if (!await rateLimit(req, "disponibilidad", 30)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const { slug } = await paramsDe(ctx);
  const url = new URL(req.url);
  const colaId = Number(url.searchParams.get("colaId"));
  if (!colaId) return error("VALIDACION", "Indica la cola", 422);
  return ok(await disponibilidad(slug, colaId, Math.min(14, Number(url.searchParams.get("dias") ?? 14))));
});
