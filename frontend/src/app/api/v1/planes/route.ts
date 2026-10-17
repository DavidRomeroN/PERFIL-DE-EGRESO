import { auditar, conRol, ok, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { invalidarModulos } from "@backend/modulos";
import { planSchema } from "@backend/schemas";

/** GET /api/v1/planes — catálogo con módulos incluidos */
export const GET = conRol(["SUPER_ADMIN", "ADMIN_LOCAL"], async () =>
  ok(await prisma.plan.findMany({ orderBy: { precioMensual: "asc" }, include: { modulos: true, _count: { select: { locales: true } } } })),
);



/** POST /api/v1/planes — N08 (solo SUPER_ADMIN) */
export const POST = conRol(["SUPER_ADMIN"], async (req, ctx) => {
  const { modulos, ...b } = await parseBody(req, planSchema);
  const p = await prisma.plan.create({ data: { ...b, modulos: { create: modulos.map((m) => ({ modulo: m })) } }, include: { modulos: true } });
  invalidarModulos();
  await auditar(ctx, { localId: null, accion: "PLAN_CREAR", entidad: "plan", entidadId: p.id, humana: `Creó el plan ${p.nombre}` });
  return ok(p, { status: 201 });
});
