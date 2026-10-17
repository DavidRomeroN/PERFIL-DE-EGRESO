import { conRol, error, ok, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { hashPassword } from "@backend/auth";
import { localDeSesion, registrarAuditoria } from "@backend/admin";
import { usuarioSchema } from "@backend/schemas";

const ADMIN = ["ADMIN_LOCAL", "SUPER_ADMIN"] as const;

const select = { id: true, nombre: true, email: true, rol: true, activo: true, createdAt: true, ultimoAcceso: true, localId: true } as const;

/** GET /api/v1/usuarios — RF10 */
export const GET = conRol([...ADMIN], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  const usuarios = await prisma.usuario.findMany({ where: { localId }, orderBy: [{ rol: "asc" }, { nombre: "asc" }], select });
  return ok(usuarios);
});

/** POST /api/v1/usuarios */
export const POST = conRol([...ADMIN], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  const body = await parseBody(req, usuarioSchema);
  if (!body.password) return error("VALIDACION", "La contraseña es obligatoria al crear un usuario", 422);
  const existe = await prisma.usuario.findUnique({ where: { email: body.email } });
  if (existe) return error("DUPLICADO", "Ya existe un usuario con ese correo", 409);
  const u = await prisma.usuario.create({
    data: { nombre: body.nombre, email: body.email, rol: body.rol, activo: body.activo, localId, hashPassword: await hashPassword(body.password) },
    select,
  });
  await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "CREAR", entidad: "usuario", entidadId: u.id, datos: { email: u.email, rol: u.rol } });
  return ok(u, { status: 201 });
});
