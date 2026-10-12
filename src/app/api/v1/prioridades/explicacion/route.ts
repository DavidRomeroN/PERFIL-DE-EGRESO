import { ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { STAFF, enLocal, qNum } from "@/lib/rutas";
import { explicacionSiguiente } from "@/lib/prioridades/service";

/** GET /api/v1/prioridades/explicacion?colaId — por qué el siguiente turno es el siguiente (RF-M1-06) */
export const GET = enLocal(STAFF, "M1", async (req, ctx) => {
  const local = await prisma.local.findUniqueOrThrow({ where: { id: ctx.localId } });
  return ok(await explicacionSiguiente(ctx.localId, qNum(req, "colaId"), local.zonaHoraria));
});
