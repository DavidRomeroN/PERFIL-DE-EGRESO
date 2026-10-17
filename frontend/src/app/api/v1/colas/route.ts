import { conRol, error, ok, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { localDeSesion, registrarAuditoria } from "@backend/admin";
import { publicar } from "@backend/realtime";
import { colaSchema } from "@backend/schemas";

const ADMIN = ["ADMIN_LOCAL", "SUPER_ADMIN"] as const;

/** GET /api/v1/colas — RF08 */
export const GET = conRol([...ADMIN, "OPERADOR"], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  const colas = await prisma.cola.findMany({
    where: { localId },
    orderBy: [{ orden: "asc" }, { id: "asc" }],
    include: { ventanillas: { select: { id: true, nombre: true, activa: true } }, _count: { select: { turnos: true } } },
  });
  return ok(colas);
});

/** POST /api/v1/colas */
export const POST = conRol([...ADMIN], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  const body = await parseBody(req, colaSchema);
  const local = await prisma.local.findUnique({ where: { id: localId }, include: { plan: true, _count: { select: { colas: true } } } });
  if (!local) return error("LOCAL_NO_ENCONTRADO", "Local no encontrado", 404);
  if (local._count.colas >= local.plan.maxColas) {
    return error("LIMITE_PLAN", `Tu plan ${local.plan.nombre} permite hasta ${local.plan.maxColas} cola(s). Mejora tu plan para agregar más.`, 402);
  }
  const cola = await prisma.cola.create({ data: { ...body, prefijo: body.prefijo.toUpperCase(), localId } });
  await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "CREAR", entidad: "cola", entidadId: cola.id, datos: body });
  publicar({ tipo: "cola:actualizada", localId });
  return ok(cola, { status: 201 });
});
