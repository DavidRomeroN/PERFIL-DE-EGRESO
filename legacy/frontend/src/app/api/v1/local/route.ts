import { conRol, error, ok, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { localDeSesion, registrarAuditoria } from "@backend/admin";
import { publicar } from "@backend/realtime";
import { localConfigSchema } from "@backend/schemas";

const ADMIN = ["ADMIN_LOCAL", "SUPER_ADMIN"] as const;

/** GET /api/v1/local — configuración del local actual */
export const GET = conRol([...ADMIN, "OPERADOR"], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  const local = await prisma.local.findUnique({
    where: { id: localId },
    include: { plan: true, _count: { select: { colas: true, ventanillas: true, usuarios: true } } },
  });
  if (!local) return error("LOCAL_NO_ENCONTRADO", "Local no encontrado", 404);
  return ok(local);
});

/** PATCH /api/v1/local — RF12 personalización (logo, mensajes, color) */
export const PATCH = conRol([...ADMIN], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  const body = await parseBody(req, localConfigSchema);
  const local = await prisma.local.update({
    where: { id: localId },
    data: { ...body, logoUrl: body.logoUrl === "" ? null : body.logoUrl },
    include: { plan: true },
  });
  await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "EDITAR", entidad: "local", entidadId: localId, datos: body });
  publicar({ tipo: "cola:actualizada", localId });
  return ok(local);
});
