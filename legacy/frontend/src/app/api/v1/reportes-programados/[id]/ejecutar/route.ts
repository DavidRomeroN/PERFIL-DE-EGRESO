import { error, ok, paramsDe } from "@backend/api";
import { prisma } from "@backend/db";
import { fechaLocalISO, sumarDiasISO } from "@backend/fechas";
import { ADMIN, enLocal } from "@backend/rutas";
import { ejecutarReporte } from "@backend/analitica/reportes";

/** POST /api/v1/reportes-programados/:id/ejecutar — genera ya el periodo en curso (marcado manual) */
export const POST = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M7", async (_req, ctx) => {
  const id = Number((await paramsDe(ctx)).id);
  const p = await prisma.reporteProgramado.findFirst({ where: { id, localId: ctx.localId }, include: { local: true } });
  if (!p) return error("NO_ENCONTRADO", "La programación no existe", 404);
  const hoy = fechaLocalISO(p.local.zonaHoraria);
  const dias = p.frecuencia === "DIARIO" ? 0 : p.frecuencia === "SEMANAL" ? 6 : 29;
  const desde = sumarDiasISO(hoy, -dias);
  return ok(await ejecutarReporte(id, { periodo: `${desde}_${hoy}`, desde, hasta: hoy }, true));
});
