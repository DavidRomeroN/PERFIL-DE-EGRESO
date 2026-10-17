import { ok } from "@backend/api";
import { prisma } from "@backend/db";
import { fechaADate, fechaLocalISO } from "@backend/fechas";
import { STAFF, enLocal, q, qNum } from "@backend/rutas";
import type { EstadoTurno, Prisma } from "@backend/generated/prisma/client";

/** GET /api/v1/turnos?ventanillaId&fecha&estado&cursor — historial del operador (N02) con KPIs del día */
export const GET = enLocal(STAFF, null, async (req, ctx) => {
  const local = await prisma.local.findUniqueOrThrow({ where: { id: ctx.localId } });
  const fecha = fechaADate(q(req, "fecha") ?? fechaLocalISO(local.zonaHoraria));
  const where: Prisma.TurnoWhereInput = { localId: ctx.localId, fecha };
  if (qNum(req, "ventanillaId")) where.ventanillaId = qNum(req, "ventanillaId");
  if (q(req, "estado")) where.estado = q(req, "estado") as EstadoTurno;
  const cursor = qNum(req, "cursor");
  const items = await prisma.turno.findMany({
    where: { ...where, ...(cursor ? { id: { lt: cursor } } : {}) },
    orderBy: { id: "desc" },
    take: 50,
    select: { id: true, codigo: true, codigoProvisional: true, estado: true, canal: true, emitidoAt: true, llamadoAt: true, finalizadoAt: true, rellamadas: true, cola: { select: { nombre: true } }, ventanilla: { select: { nombre: true } }, cliente: { select: { nombre: true } } },
  });
  const delDia = await prisma.turno.findMany({ where, select: { estado: true, emitidoAt: true, llamadoAt: true, finalizadoAt: true } });
  const at = delDia.filter((t) => t.estado === "ATENDIDO" && t.llamadoAt && t.finalizadoAt);
  const prom = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length / 60000) * 10) / 10 : 0);
  return ok({
    items,
    cursor: items.length === 50 ? items[items.length - 1].id : null,
    kpis: {
      total: delDia.length,
      atendidos: at.length,
      noPresentados: delDia.filter((t) => t.estado === "NO_SE_PRESENTO").length,
      atencionPromMin: prom(at.map((t) => t.finalizadoAt!.getTime() - t.llamadoAt!.getTime())),
      esperaPromMin: prom(delDia.filter((t) => t.llamadoAt).map((t) => t.llamadoAt!.getTime() - t.emitidoAt.getTime())),
    },
  });
});
