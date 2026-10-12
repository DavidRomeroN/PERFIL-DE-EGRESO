import { ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { fechaLocalISO } from "@/lib/fechas";
import { STAFF, enLocal, q, qNum } from "@/lib/rutas";
import { agenda } from "@/lib/citas/service";

/** GET /api/v1/citas?fecha&colaId — agenda del día (nombres solo para el personal del local) */
export const GET = enLocal(STAFF, "M3", async (req, ctx) => {
  const local = await prisma.local.findUniqueOrThrow({ where: { id: ctx.localId } });
  const fecha = q(req, "fecha") ?? fechaLocalISO(local.zonaHoraria);
  return ok(await agenda(ctx.localId, fecha, qNum(req, "colaId")));
});
