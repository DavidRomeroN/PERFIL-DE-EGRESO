import { z } from "zod";
import { ok, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { fechaLocalISO, sumarDiasISO } from "@/lib/fechas";
import { ADMIN, enLocal } from "@/lib/rutas";
import { enviarCorreo, smtpConfigurado } from "@/lib/correo";
import { datosReporte, generarPdf } from "@/lib/analitica/reportes";

const schema = z.object({ para: z.array(z.string().email()).min(1).max(10).optional() });

/** POST /api/v1/reportes/correo — envía el PDF de los últimos 7 días (nodemailer, D12) */
export const POST = enLocal(ADMIN, "M7", async (req, ctx) => {
  const b = await parseBody(req, schema);
  const l = await prisma.local.findUniqueOrThrow({ where: { id: ctx.localId } });
  const hasta = fechaLocalISO(l.zonaHoraria);
  const desde = sumarDiasISO(hasta, -6);
  const pdf = await generarPdf(await datosReporte(ctx.localId, desde, hasta, "Reporte semanal"));
  const para = b.para ?? (process.env.REPORTE_EMAIL ? [process.env.REPORTE_EMAIL] : [ctx.session.email]);
  const r = await enviarCorreo({ para, asunto: `[TurnoYa] Reporte ${l.nombreComercial} ${desde} a ${hasta}`, texto: "Adjuntamos el reporte de atención.", adjuntos: [{ nombre: `turnoya-${desde}_${hasta}.pdf`, contenido: pdf, tipo: "application/pdf" }] });
  return ok({ ...r, smtp: smtpConfigurado(), para });
});
