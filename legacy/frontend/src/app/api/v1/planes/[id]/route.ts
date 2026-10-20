import { auditar, conRol, error, ok, paramsDe, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { invalidarModulos } from "@backend/modulos";
import { planSchema } from "@backend/schemas";

type P = { params: Promise<{ id: string }> };

/** PATCH /api/v1/planes/:id — edita límites y la matriz plan_modulo (N08) */
export const PATCH = conRol<P>(["SUPER_ADMIN"], async (req, ctx) => {
  const id = Number((await paramsDe(ctx)).id);
  const { modulos, ...b } = await parseBody(req, planSchema.partial());
  const p = await prisma.$transaction(async (tx) => {
    const r = await tx.plan.update({ where: { id }, data: b });
    if (modulos) {
      await tx.planModulo.deleteMany({ where: { planId: id } });
      await tx.planModulo.createMany({ data: modulos.map((m) => ({ planId: id, modulo: m })) });
    }
    return r;
  });
  invalidarModulos();
  await auditar(ctx, { localId: null, accion: "PLAN_EDITAR", entidad: "plan", entidadId: id, humana: `Editó el plan ${p.nombre}`, datos: { ...b, modulos } });
  return ok(await prisma.plan.findUnique({ where: { id }, include: { modulos: true } }));
});

export const DELETE = conRol<P>(["SUPER_ADMIN"], async (_req, ctx) => {
  const id = Number((await paramsDe(ctx)).id);
  const enUso = await prisma.local.count({ where: { planId: id } });
  if (enUso) return error("PLAN_EN_USO", `El plan tiene ${enUso} locales`, 409);
  await prisma.plan.delete({ where: { id } });
  await auditar(ctx, { localId: null, accion: "PLAN_ELIMINAR", entidad: "plan", entidadId: id });
  return ok({ eliminado: true });
});
