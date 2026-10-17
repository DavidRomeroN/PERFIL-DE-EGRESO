import { z } from "zod";
import { auditar, ok, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { ADMIN, enLocal } from "@backend/rutas";
import { localAbierto } from "@backend/operacion";

/**
 * Operación del núcleo: horario del local (N05) y expiración de llamados (N04/RN04).
 * Las prioridades viven en /prioridades (M1), las citas en /citas (M3) y la transferencia en /turnos/:id/transferir (M6).
 */
export const GET = enLocal(ADMIN, null, async (_req, ctx) => {
  const local = await prisma.local.findUniqueOrThrow({ where: { id: ctx.localId } });
  const horarios = await prisma.horarioLocal.findMany({ where: { localId: ctx.localId }, orderBy: { diaSemana: "asc" } });
  return ok({ horarios, tiempoAusenciaSeg: local.tiempoAusenciaSeg, estado: await localAbierto(ctx.localId, local.zonaHoraria) });
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM");
const schema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("horario"), diaSemana: z.number().int().min(0).max(6), apertura: hhmm, cierre: hhmm, activo: z.boolean() }),
  z.object({ accion: z.literal("borrar-horario"), diaSemana: z.number().int().min(0).max(6) }),
  /** null = expiración automática desactivada (opt-in, C7) */
  z.object({ accion: z.literal("ausencia"), ausenciaSeg: z.number().int().min(30).max(900).nullable() }),
]);

export const POST = enLocal(ADMIN, null, async (req, ctx) => {
  const b = await parseBody(req, schema);
  if (b.accion === "horario") {
    if (b.apertura >= b.cierre) return ok({ listo: false, error: "La apertura debe ser antes del cierre" });
    await prisma.horarioLocal.upsert({
      where: { localId_diaSemana: { localId: ctx.localId, diaSemana: b.diaSemana } },
      create: { localId: ctx.localId, diaSemana: b.diaSemana, apertura: b.apertura, cierre: b.cierre, activo: b.activo },
      update: { apertura: b.apertura, cierre: b.cierre, activo: b.activo },
    });
    await auditar(ctx, { localId: ctx.localId, accion: "HORARIO", entidad: "horario_local", entidadId: b.diaSemana, humana: `Horario del día ${b.diaSemana}: ${b.activo ? `${b.apertura}–${b.cierre}` : "cerrado"}` });
  }
  if (b.accion === "borrar-horario") await prisma.horarioLocal.deleteMany({ where: { localId: ctx.localId, diaSemana: b.diaSemana } });
  if (b.accion === "ausencia") {
    await prisma.local.update({ where: { id: ctx.localId }, data: { tiempoAusenciaSeg: b.ausenciaSeg } });
    await auditar(ctx, { localId: ctx.localId, accion: "AUSENCIA", entidad: "local", entidadId: ctx.localId, humana: b.ausenciaSeg ? `Expiración automática a los ${b.ausenciaSeg} s` : "Desactivó la expiración automática" });
  }
  return ok({ listo: true });
});
