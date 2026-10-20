import { ok, paramsDe, publico } from "@backend/api";
import { prisma } from "@backend/db";
import { moduloActivo } from "@backend/modulos";

/** GET /api/v1/public/locales/:slug/citas — servicios que atienden con cita (M3) */
export const GET = publico<{ params: Promise<{ slug: string }> }>(async (_req, ctx) => {
  const { slug } = await paramsDe(ctx);
  const local = await prisma.local.findUnique({ where: { slug } });
  if (!local || !local.activo || !(await moduloActivo(local.id, "M3"))) return ok({ disponible: false, colas: [] });
  const colas = await prisma.cola.findMany({ where: { localId: local.id, activa: true, configCitas: { activo: true } }, orderBy: { orden: "asc" }, select: { id: true, nombre: true, descripcion: true, configCitas: { select: { duracionSlotMin: true, anticipacionMaxDias: true } } } });
  return ok({ disponible: colas.length > 0, local: { nombre: local.nombreComercial, color: local.colorPrimario }, colas });
});
