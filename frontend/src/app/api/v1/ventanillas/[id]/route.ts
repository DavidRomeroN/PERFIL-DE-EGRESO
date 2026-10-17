import { conRol, error, ok, paramsDe, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { localDeSesion, registrarAuditoria } from "@backend/admin";
import { publicar } from "@backend/realtime";
import { ventanillaSchema } from "@backend/schemas";

type Ctx = { params: Promise<{ id: string }> };
const ADMIN = ["ADMIN_LOCAL", "SUPER_ADMIN"] as const;

export const PATCH = conRol<Ctx>([...ADMIN], async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const localId = await localDeSesion(req, ctx.session);
  const body = await parseBody(req, ventanillaSchema.partial());
  const existente = await prisma.ventanilla.findFirst({ where: { id: Number(id), localId } });
  if (!existente) return error("NO_ENCONTRADO", "Ventanilla no encontrada", 404);
  if (body.colaId) {
    const cola = await prisma.cola.findFirst({ where: { id: body.colaId, localId } });
    if (!cola) return error("VALIDACION", "La cola no pertenece a este local", 422);
  }
  const v = await prisma.ventanilla.update({
    where: { id: existente.id },
    data: { nombre: body.nombre, activa: body.activa, colaId: body.colaId === undefined ? undefined : body.colaId },
  });
  await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "EDITAR", entidad: "ventanilla", entidadId: v.id, datos: body });
  publicar({ tipo: "cola:actualizada", localId });
  return ok(v);
});

export const DELETE = conRol<Ctx>([...ADMIN], async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const localId = await localDeSesion(req, ctx.session);
  const existente = await prisma.ventanilla.findFirst({ where: { id: Number(id), localId }, include: { _count: { select: { turnos: true } } } });
  if (!existente) return error("NO_ENCONTRADO", "Ventanilla no encontrada", 404);
  if (existente._count.turnos > 0) {
    const v = await prisma.ventanilla.update({ where: { id: existente.id }, data: { activa: false } });
    await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "DESACTIVAR", entidad: "ventanilla", entidadId: v.id });
    publicar({ tipo: "cola:actualizada", localId });
    return ok({ desactivada: true, ventanilla: v });
  }
  await prisma.ventanilla.delete({ where: { id: existente.id } });
  await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "ELIMINAR", entidad: "ventanilla", entidadId: existente.id });
  publicar({ tipo: "cola:actualizada", localId });
  return ok({ eliminada: true });
});
