import { ok } from "@backend/api";
import { prisma } from "@backend/db";
import { fechaLocalISO } from "@backend/fechas";
import { STAFF, enLocal, q, qNum } from "@backend/rutas";
import { agenda } from "@backend/citas/service";

/** GET /api/v1/citas?fecha&colaId — agenda del día (nombres solo para el personal del local) */
export const GET = enLocal(STAFF, "M3", async (req, ctx) => {
  const local = await prisma.local.findUniqueOrThrow({ where: { id: ctx.localId } });
  const fecha = q(req, "fecha") ?? fechaLocalISO(local.zonaHoraria);
  return ok(await agenda(ctx.localId, fecha, qNum(req, "colaId")));
});
