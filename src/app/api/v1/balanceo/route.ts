import { conRol, ok } from "@/lib/api";
import { localActualAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { sugerirMovimiento } from "@/lib/balanceo/reglas";
import { ErrorNegocio } from "@/lib/turnos";

export const POST = conRol(["ADMIN_LOCAL", "SUPER_ADMIN"], async (_req, ctx) => {
  const local = await localActualAdmin(ctx.session);
  if (!local) throw new ErrorNegocio("SIN_LOCAL", "Elige un local", 409);
  const colas = await prisma.cola.findMany({
    where: { localId: local.id, activa: true },
    include: { _count: { select: { turnos: { where: { estado: { in: ["EMITIDO", "AVISADO"] } } } } }, ventanillas: true },
  });
  const mov = sugerirMovimiento(colas.map((c) => ({ colaId: c.id, enEspera: c._count.turnos, ventanillas: c.ventanillas.length })));
  if (!mov) return ok({ movido: false });
  const ventanilla = await prisma.ventanilla.findFirst({ where: { localId: local.id, colaId: mov.desde, activa: true } });
  if (!ventanilla) return ok({ movido: false });
  await prisma.ventanilla.update({ where: { id: ventanilla.id }, data: { colaId: mov.hacia } });
  await prisma.auditoria.create({
    data: { localId: local.id, usuarioId: ctx.session.sub, accion: "BALANCEO", entidad: "ventanilla", entidadId: String(ventanilla.id), datosJson: mov },
  });
  return ok({ movido: true, ...mov, ventanilla: ventanilla.nombre });
});
