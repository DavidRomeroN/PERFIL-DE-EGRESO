import { ok } from "@backend/api";
import { prisma } from "@backend/db";
import { ErrorNegocio } from "@backend/errores";
import { fechaLocalISO, sumarDiasISO } from "@backend/fechas";
import { ADMIN, enLocal, q } from "@backend/rutas";
import { csat } from "@backend/analitica/consultas";
function rango(req: Parameters<typeof q>[0], zona: string) {
  const hasta = q(req, "hasta") ?? fechaLocalISO(zona);
  const desde = q(req, "desde") ?? sumarDiasISO(hasta, -55);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) throw new ErrorNegocio("VALIDACION", "Rango de fechas inválido", 422);
  return { desde, hasta };
}

export const GET = enLocal(ADMIN, "M7", async (req, ctx) => {
  const l = await prisma.local.findUniqueOrThrow({ where: { id: ctx.localId } });
  const r = rango(req, l.zonaHoraria);
  return ok(await csat(ctx.localId, r.desde, r.hasta));
});
