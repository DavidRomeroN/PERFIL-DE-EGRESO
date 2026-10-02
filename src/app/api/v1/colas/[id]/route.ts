import { conRol, error, ok, paramsDe, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { localDeSesion, registrarAuditoria } from "@/lib/admin";
import { publicar } from "@/lib/realtime";
import { colaSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };
const ADMIN = ["ADMIN_LOCAL", "SUPER_ADMIN"] as const;

export const PATCH = conRol<Ctx>([...ADMIN], async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const localId = await localDeSesion(req, ctx.session);
  const body = await parseBody(req, colaSchema.partial());
  const existente = await prisma.cola.findFirst({ where: { id: Number(id), localId } });
  if (!existente) return error("NO_ENCONTRADO", "Cola no encontrada", 404);
  const cola = await prisma.cola.update({
    where: { id: existente.id },
    data: { ...body, prefijo: body.prefijo?.toUpperCase() },
  });
  await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "EDITAR", entidad: "cola", entidadId: cola.id, datos: body });
  publicar({ tipo: "cola:actualizada", localId });
  return ok(cola);
});

export const DELETE = conRol<Ctx>([...ADMIN], async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const localId = await localDeSesion(req, ctx.session);
  const existente = await prisma.cola.findFirst({ where: { id: Number(id), localId }, include: { _count: { select: { turnos: true } } } });
  if (!existente) return error("NO_ENCONTRADO", "Cola no encontrada", 404);
  if (existente._count.turnos > 0) {
    // Conserva el historial: desactivar en lugar de borrar
    const cola = await prisma.cola.update({ where: { id: existente.id }, data: { activa: false } });
    await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "DESACTIVAR", entidad: "cola", entidadId: cola.id });
    publicar({ tipo: "cola:actualizada", localId });
    return ok({ desactivada: true, cola });
  }
  await prisma.cola.delete({ where: { id: existente.id } });
  await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "ELIMINAR", entidad: "cola", entidadId: existente.id });
  publicar({ tipo: "cola:actualizada", localId });
  return ok({ eliminada: true });
});
