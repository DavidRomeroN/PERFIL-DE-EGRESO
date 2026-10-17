import { error, ok, paramsDe, publico, rateLimit } from "@backend/api";
import { resolverProvisional } from "@backend/kiosco/service";

/** GET /api/v1/public/k/:dispositivo/:fecha/:seq — resuelve el QR del ticket provisional */
export const GET = publico<{ params: Promise<{ dispositivo: string; fecha: string; seq: string }> }>(async (req, ctx) => {
  if (!await rateLimit(req, "k", 30)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const p = await paramsDe(ctx);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha)) return error("VALIDACION", "Fecha inválida", 422);
  return ok(await resolverProvisional(Number(p.dispositivo), p.fecha, Number(p.seq)));
});
