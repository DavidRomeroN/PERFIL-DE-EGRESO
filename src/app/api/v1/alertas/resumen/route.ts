import { ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { moduloActivo } from "@/lib/modulos";
import { ADMIN, enLocal } from "@/lib/rutas";

/** GET /api/v1/alertas/resumen — contador para la campana (no exige M7: devuelve 0 si está apagado) */
export const GET = enLocal(ADMIN, null, async (_req, ctx) => {
  if (!(await moduloActivo(ctx.localId, "M7"))) return ok({ activo: false, abiertas: 0, ultimas: [] });
  const abiertas = await prisma.alerta.count({ where: { localId: ctx.localId, estado: "ABIERTA" } });
  const ultimas = await prisma.alerta.findMany({ where: { localId: ctx.localId, estado: { in: ["ABIERTA", "RECONOCIDA"] } }, orderBy: { ultimaVezAt: "desc" }, take: 5, select: { id: true, titulo: true, nivel: true, estado: true, ultimaVezAt: true } });
  return ok({ activo: true, abiertas, ultimas: ultimas.map((u) => ({ ...u, id: String(u.id) })) });
});
