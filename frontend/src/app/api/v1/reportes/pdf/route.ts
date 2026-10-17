import { ADMIN, enLocal, q } from "@backend/rutas";
import { prisma } from "@backend/db";
import { fechaLocalISO, sumarDiasISO } from "@backend/fechas";
import { datosReporte, generarPdf } from "@backend/analitica/reportes";

/** GET /api/v1/reportes/pdf?desde&hasta — PDF del rango (M7) */
export const GET = enLocal(ADMIN, "M7", async (req, ctx) => {
  const l = await prisma.local.findUniqueOrThrow({ where: { id: ctx.localId } });
  const hasta = q(req, "hasta") ?? fechaLocalISO(l.zonaHoraria);
  const desde = q(req, "desde") ?? sumarDiasISO(hasta, -6);
  const pdf = await generarPdf(await datosReporte(ctx.localId, desde, hasta, "Reporte de atención"));
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="turnoya-${desde}_${hasta}.pdf"` } });
});
