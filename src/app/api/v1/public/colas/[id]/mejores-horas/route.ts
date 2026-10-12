import { error, ok, paramsDe, publico, rateLimit } from "@/lib/api";
import { prisma } from "@/lib/db";
import { moduloActivo } from "@/lib/modulos";
import { mejoresHoras } from "@/lib/prediccion/service";

/** GET /api/v1/public/colas/:id/mejores-horas — espera esperada por franja del resto del día (RF-M2-06) */
export const GET = publico<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  if (!await rateLimit(req, "mejores-horas", 30)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const { id } = await paramsDe(ctx);
  const cola = await prisma.cola.findUnique({ where: { id: Number(id) }, select: { localId: true, activa: true } });
  if (!cola || !cola.activa) return error("COLA_INACTIVA", "La cola no existe", 404);
  if (!(await moduloActivo(cola.localId, "M2"))) return ok([]);
  return ok(await mejoresHoras(Number(id)));
});
