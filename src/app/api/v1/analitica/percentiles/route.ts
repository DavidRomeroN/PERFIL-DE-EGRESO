import { ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ErrorNegocio } from "@/lib/errores";
import { fechaLocalISO, sumarDiasISO } from "@/lib/fechas";
import { ADMIN, enLocal, q, qNum } from "@/lib/rutas";
import { percentiles } from "@/lib/analitica/consultas";
function rango(req: Parameters<typeof q>[0], zona: string) {
  const hasta = q(req, "hasta") ?? fechaLocalISO(zona);
  const desde = q(req, "desde") ?? sumarDiasISO(hasta, -55);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) throw new ErrorNegocio("VALIDACION", "Rango de fechas inválido", 422);
  return { desde, hasta };
}

/** GET /api/v1/analitica/percentiles?agrupar=cola|hora|dia */
export const GET = enLocal(ADMIN, "M7", async (req, ctx) => {
  const l = await prisma.local.findUniqueOrThrow({ where: { id: ctx.localId } });
  const r = rango(req, l.zonaHoraria);
  const a = q(req, "agrupar") ?? "cola";
  if (!["cola", "hora", "dia"].includes(a)) throw new ErrorNegocio("VALIDACION", "Agrupación inválida", 422);
  return ok(await percentiles(ctx.localId, r.desde, r.hasta, qNum(req, "colaId"), a as "cola" | "hora" | "dia"));
});
