import { z } from "zod";
import { conRol, ok, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { localActualAdmin } from "@/lib/admin";
import { recalcularClaves, transferirTurno } from "@/lib/operacion";
import { ErrorNegocio } from "@/lib/turnos";

export const GET = conRol(["SUPER_ADMIN", "ADMIN_LOCAL"], async (_req, ctx) => {
  const local = await localActualAdmin(ctx.session);
  if (!local) throw new ErrorNegocio("SIN_LOCAL", "Elige un local", 409);
  const [categorias, config, horarios, citas] = await Promise.all([
    prisma.categoriaPrioridad.findMany({ where: { localId: local.id }, orderBy: { orden: "asc" } }),
    prisma.configPrioridad.findUnique({ where: { localId: local.id } }),
    prisma.horarioLocal.findMany({ where: { localId: local.id }, orderBy: { diaSemana: "asc" } }),
    prisma.cita.findMany({ where: { localId: local.id, inicio: { gte: new Date(Date.now() - 3600_000) } }, orderBy: { inicio: "asc" }, take: 40 }),
  ]);
  return ok({ categorias, config, horarios, citas, tiempoAusenciaSeg: local.tiempoAusenciaSeg });
});

const patch = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("prioridad"), codigo: z.string(), pesoBase: z.number().int().min(0).max(100) }),
  z.object({ accion: z.literal("config"), alfa: z.number().min(0).max(5), tope: z.number().int().min(0).max(20), ausenciaSeg: z.number().int().min(30).max(900) }),
  z.object({ accion: z.literal("horario"), diaSemana: z.number().int().min(0).max(6), apertura: z.string().regex(/^\d{2}:\d{2}$/), cierre: z.string().regex(/^\d{2}:\d{2}$/), activo: z.boolean() }),
  z.object({ accion: z.literal("transferir"), turnoId: z.number().int(), colaDestinoId: z.number().int() }),
]);

export const POST = conRol(["SUPER_ADMIN", "ADMIN_LOCAL", "OPERADOR"], async (req, ctx) => {
  const body = await parseBody(req, patch);
  const local = await localActualAdmin(ctx.session);
  if (!local) throw new ErrorNegocio("SIN_LOCAL", "Elige un local", 409);
  if (body.accion === "transferir") {
    const turno = await transferirTurno(body.turnoId, local.id, body.colaDestinoId);
    return ok(turno);
  }
  if (ctx.session.rol === "OPERADOR") throw new ErrorNegocio("PROHIBIDO", "Solo un administrador cambia esta configuración", 403);
  if (body.accion === "prioridad") {
    await prisma.categoriaPrioridad.updateMany({ where: { localId: local.id, codigo: body.codigo }, data: { pesoBase: body.pesoBase } });
    await recalcularClaves(local.id);
  }
  if (body.accion === "config") {
    await prisma.configPrioridad.upsert({
      where: { localId: local.id },
      create: { localId: local.id, alfaPuntosPorMin: body.alfa, topeAdelantos: body.tope },
      update: { alfaPuntosPorMin: body.alfa, topeAdelantos: body.tope },
    });
    await prisma.local.update({ where: { id: local.id }, data: { tiempoAusenciaSeg: body.ausenciaSeg } });
    await recalcularClaves(local.id);
  }
  if (body.accion === "horario") {
    await prisma.horarioLocal.upsert({
      where: { localId_diaSemana: { localId: local.id, diaSemana: body.diaSemana } },
      create: { localId: local.id, diaSemana: body.diaSemana, apertura: body.apertura, cierre: body.cierre, activo: body.activo },
      update: { apertura: body.apertura, cierre: body.cierre, activo: body.activo },
    });
  }
  return ok({ listo: true });
});
