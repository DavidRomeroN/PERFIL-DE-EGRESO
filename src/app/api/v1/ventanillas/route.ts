import { conRol, error, ok, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { localDeSesion, registrarAuditoria } from "@/lib/admin";
import { publicar } from "@/lib/realtime";
import { ventanillaSchema } from "@/lib/schemas";

const ADMIN = ["ADMIN_LOCAL", "SUPER_ADMIN"] as const;

export const GET = conRol([...ADMIN, "OPERADOR"], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  const ventanillas = await prisma.ventanilla.findMany({
    where: { localId },
    orderBy: { id: "asc" },
    include: { cola: { select: { id: true, nombre: true, prefijo: true } } },
  });
  return ok(ventanillas);
});

export const POST = conRol([...ADMIN], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  const body = await parseBody(req, ventanillaSchema);
  const local = await prisma.local.findUnique({ where: { id: localId }, include: { plan: true, _count: { select: { ventanillas: true } } } });
  if (!local) return error("LOCAL_NO_ENCONTRADO", "Local no encontrado", 404);
  if (local._count.ventanillas >= local.plan.maxVentanillas) {
    return error("LIMITE_PLAN", `Tu plan ${local.plan.nombre} permite hasta ${local.plan.maxVentanillas} ventanilla(s).`, 402);
  }
  if (body.colaId) {
    const cola = await prisma.cola.findFirst({ where: { id: body.colaId, localId } });
    if (!cola) return error("VALIDACION", "La cola no pertenece a este local", 422);
  }
  const v = await prisma.ventanilla.create({ data: { nombre: body.nombre, colaId: body.colaId ?? null, activa: body.activa, localId } });
  await registrarAuditoria({ localId, usuarioId: ctx.session.sub, accion: "CREAR", entidad: "ventanilla", entidadId: v.id, datos: body });
  publicar({ tipo: "cola:actualizada", localId });
  return ok(v, { status: 201 });
});
