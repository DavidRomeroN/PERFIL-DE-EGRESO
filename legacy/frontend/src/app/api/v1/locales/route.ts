import { conRol, error, ok, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { hashPassword } from "@backend/auth";
import { registrarAuditoria } from "@backend/admin";
import { localSchema } from "@backend/schemas";

/** GET /api/v1/locales — RF11 (super-admin) */
export const GET = conRol(["SUPER_ADMIN"], async () => {
  const locales = await prisma.local.findMany({
    orderBy: { id: "asc" },
    include: { plan: true, _count: { select: { colas: true, ventanillas: true, usuarios: true, turnos: true } } },
  });
  const inicioMes = new Date();
  inicioMes.setUTCDate(1);
  inicioMes.setUTCHours(0, 0, 0, 0);
  const turnosMes = await prisma.turno.groupBy({ by: ["localId"], where: { fecha: { gte: inicioMes } }, _count: { _all: true } });
  const mapa = Object.fromEntries(turnosMes.map((t) => [t.localId, t._count._all]));
  return ok(locales.map((l) => ({ ...l, turnosMes: mapa[l.id] ?? 0 })));
});

/** POST /api/v1/locales — alta de local (multi-tenant) con admin inicial opcional */
export const POST = conRol(["SUPER_ADMIN"], async (req, ctx) => {
  const body = await parseBody(req, localSchema);
  const existe = await prisma.local.findUnique({ where: { slug: body.slug } });
  if (existe) return error("DUPLICADO", "Ya existe un local con ese identificador (slug)", 409);
  if (body.adminEmail) {
    const u = await prisma.usuario.findUnique({ where: { email: body.adminEmail.toLowerCase() } });
    if (u) return error("DUPLICADO", "Ya existe un usuario con ese correo", 409);
    if (!body.adminPassword) return error("VALIDACION", "Indica una contraseña para el administrador", 422);
  }
  const { adminNombre, adminEmail, adminPassword, ...data } = body;
  const local = await prisma.local.create({
    data: {
      ...data,
      mensajeBienvenida: "Toma tu turno y espera donde quieras: te avisamos cuando falte poco.",
      mensajeTv: "Bienvenido. Por favor espere su llamado.",
      colas: { create: { prefijo: "A", nombre: "Atención general", tiempoAtencionBase: 300, orden: 1 } },
      ventanillas: { create: { nombre: "Ventanilla 1" } },
      ...(adminEmail && adminPassword
        ? { usuarios: { create: { email: adminEmail.toLowerCase(), nombre: adminNombre ?? "Administrador", rol: "ADMIN_LOCAL", hashPassword: await hashPassword(adminPassword) } } }
        : {}),
    },
    include: { plan: true, colas: true, ventanillas: true },
  });
  // Asignar la ventanilla a la cola por defecto
  await prisma.ventanilla.updateMany({ where: { localId: local.id }, data: { colaId: local.colas[0].id } });
  await registrarAuditoria({ localId: local.id, usuarioId: ctx.session.sub, accion: "CREAR", entidad: "local", entidadId: local.id, datos: { slug: local.slug, planId: local.planId } });
  return ok(local, { status: 201 });
});
