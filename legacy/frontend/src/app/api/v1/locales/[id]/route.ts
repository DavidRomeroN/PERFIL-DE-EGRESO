import { conRol, error, ok, paramsDe, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { registrarAuditoria } from "@backend/admin";
import { localSchema } from "@backend/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = conRol<Ctx>(["SUPER_ADMIN"], async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const body = await parseBody(req, localSchema.partial().omit({ adminEmail: true, adminNombre: true, adminPassword: true }));
  const existente = await prisma.local.findUnique({ where: { id: Number(id) } });
  if (!existente) return error("NO_ENCONTRADO", "Local no encontrado", 404);
  const local = await prisma.local.update({ where: { id: existente.id }, data: body, include: { plan: true } });
  await registrarAuditoria({ localId: local.id, usuarioId: ctx.session.sub, accion: "EDITAR", entidad: "local", entidadId: local.id, datos: body });
  return ok(local);
});

export const DELETE = conRol<Ctx>(["SUPER_ADMIN"], async (_req, ctx) => {
  const { id } = await paramsDe(ctx);
  const existente = await prisma.local.findUnique({ where: { id: Number(id) } });
  if (!existente) return error("NO_ENCONTRADO", "Local no encontrado", 404);
  // Baja lógica: conserva datos para facturación/auditoría
  const local = await prisma.local.update({ where: { id: existente.id }, data: { activo: false } });
  await registrarAuditoria({ localId: local.id, usuarioId: ctx.session.sub, accion: "DESACTIVAR", entidad: "local", entidadId: local.id });
  return ok(local);
});
