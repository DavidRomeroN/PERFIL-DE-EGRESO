import { conRol, error, ok, paramsDe, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { hashPassword } from "@backend/auth";
import { localDeSesion, registrarAuditoria } from "@backend/admin";
import { usuarioSchema } from "@backend/schemas";

type Ctx = { params: Promise<{ id: string }> };
const ADMIN = ["ADMIN_LOCAL", "SUPER_ADMIN"] as const;
const select = { id: true, nombre: true, email: true, rol: true, activo: true, createdAt: true, ultimoAcceso: true, localId: true } as const;

export const PATCH = conRol<Ctx>([...ADMIN], async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const localId = await localDeSesion(req, ctx.session);
  const body = await parseBody(req, usuarioSchema.partial());
  const existente = await prisma.usuario.findFirst({ where: { id: Number(id), localId } });
  if (!existente) return error("NO_ENCONTRADO", "Usuario no encontrado", 404);
  if (existente.id === ctx.session.sub && body.activo === false) return error("VALIDACION", "No puedes desactivar tu propia cuenta", 422);
  const u = await prisma.usuario.update({
    where: { id: existente.id },
    data: {
      nombre: body.nombre,
      email: body.email,
      rol: body.rol,
      activo: body.activo,
      ...(body.password ? { hashPassword: await hashPassword(body.password) } : {}),
    },
    select,
  });
  await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "EDITAR", entidad: "usuario", entidadId: u.id, datos: { ...body, password: body.password ? "***" : undefined } });
  return ok(u);
});

export const DELETE = conRol<Ctx>([...ADMIN], async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const localId = await localDeSesion(req, ctx.session);
  const existente = await prisma.usuario.findFirst({ where: { id: Number(id), localId } });
  if (!existente) return error("NO_ENCONTRADO", "Usuario no encontrado", 404);
  if (existente.id === ctx.session.sub) return error("VALIDACION", "No puedes eliminar tu propia cuenta", 422);
  await prisma.usuario.delete({ where: { id: existente.id } });
  await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "ELIMINAR", entidad: "usuario", entidadId: existente.id, datos: { email: existente.email } });
  return ok({ eliminado: true });
});
