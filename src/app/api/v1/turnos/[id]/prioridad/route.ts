import { z } from "zod";
import { conRol, error, ok, paramsDe, parseBody } from "@/lib/api";
import { localActualAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { aplicarPrioridad } from "@/lib/operacion";
import { publicar } from "@/lib/realtime";

const schema = z.object({
  accion: z.enum(["VERIFICAR", "RECHAZAR", "CAMBIAR"]),
  categoriaCodigo: z.string().max(16).optional(),
});

export const PATCH = conRol<{ params: Promise<{ id: string }> }>(["OPERADOR", "ADMIN_LOCAL", "SUPER_ADMIN"], async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const body = await parseBody(req, schema);
  const turno = await prisma.turno.findUnique({ where: { id: Number(id) } });
  if (!turno) return error("NO_ENCONTRADO", "El turno no existe", 404);
  const local = await localActualAdmin(ctx.session);
  if (!local || turno.localId !== local.id) return error("PROHIBIDO", "Turno de otro local", 403);
  if (body.accion === "VERIFICAR") {
    await prisma.turno.update({ where: { id: turno.id }, data: { prioridadVerificada: true } });
  } else {
    const codigo = body.accion === "RECHAZAR" ? "GENERAL" : body.categoriaCodigo ?? "GENERAL";
    await aplicarPrioridad(turno.id, codigo, "PERSONAL");
    await prisma.turno.update({ where: { id: turno.id }, data: { emitidoAt: turno.emitidoAt, prioridadVerificada: body.accion === "CAMBIAR" } });
  }
  await prisma.auditoria.create({
    data: { localId: turno.localId, usuarioId: ctx.session.sub, accion: `PRIORIDAD_${body.accion}`, entidad: "turno", entidadId: String(turno.id) },
  });
  publicar({ tipo: "cola:actualizada", localId: turno.localId });
  return ok({ id: turno.id });
});
