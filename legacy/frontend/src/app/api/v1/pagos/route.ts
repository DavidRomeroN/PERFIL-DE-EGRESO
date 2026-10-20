import { ok } from "@backend/api";
import { prisma } from "@backend/db";
import { ADMIN, enLocal } from "@backend/rutas";
import { historialPagos } from "@backend/pagos/service";
import { configMercadoPago } from "@backend/pagos/mercadopago";

/** GET /api/v1/pagos — plan actual del local, vencimiento, planes disponibles e historial de pagos. */
export const GET = enLocal(ADMIN, null, async (_req, ctx) => {
  const local = await prisma.local.findUniqueOrThrow({ where: { id: ctx.localId }, include: { plan: true } });
  const planes = await prisma.plan.findMany({ orderBy: { precioMensual: "asc" }, include: { modulos: true } });
  const pagos = await historialPagos(ctx.localId);
  return ok({
    plan: { codigo: local.plan.codigo, nombre: local.plan.nombre, precio: Number(local.plan.precioMensual) },
    venceAt: local.planVenceAt,
    pagosHabilitados: configMercadoPago().configurado,
    planes: planes.map((p) => ({ codigo: p.codigo, nombre: p.nombre, precio: Number(p.precioMensual), descripcion: p.descripcion, modulos: p.modulos.map((m) => m.modulo).sort() })),
    pagos: pagos.map((p) => ({ id: p.id, fecha: p.creadoAt, plan: p.plan.nombre, meses: p.meses, monto: Number(p.monto), estado: p.estado, detalle: p.estadoDetalle, metodo: p.metodo, ultimos4: p.ultimos4 })),
  });
});
