import { error, ok, paramsDe, publico, rateLimit } from "@backend/api";
import { prisma } from "@backend/db";
import { resultado } from "@backend/pagos/service";

/** GET /api/v1/public/pagos/:id?clave= — estado de un pago en revisión (la clave de idempotencia evita enumerar pagos ajenos). */
export const GET = publico<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  if (!await rateLimit(req, "pago-estado", 30)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const { id } = await paramsDe(ctx);
  const clave = new URL(req.url).searchParams.get("clave") ?? "";
  const p = await prisma.pago.findFirst({ where: { id: Number(id), claveIdem: clave } });
  if (!p) return error("NO_ENCONTRADO", "El pago no existe", 404);
  return ok(await resultado(p.id));
});
