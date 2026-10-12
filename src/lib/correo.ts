import { prisma } from "@/lib/db";

/** Arma el resumen y lo envía si hay SMTP configurado. Si no, lo deja listo para descargar. */
export async function reportePorCorreo(localId: number) {
  const local = await prisma.local.findUnique({ where: { id: localId } });
  const total = await prisma.turno.count({ where: { localId } });
  const texto = `TurnoYa ${local?.nombreComercial ?? ""}\nTurnos: ${total}\n${new Date().toLocaleString("es-PE")}`;
  const host = process.env.SMTP_HOST;
  const to = process.env.REPORTE_EMAIL;
  if (!host || !to) return { enviado: false, texto };
  const cargar = new Function("return import('nodemailer')") as () => Promise<{ createTransport: (o: object) => { sendMail: (m: object) => Promise<unknown> } }>;
  const nodemailer = await cargar().catch(() => null);
  if (!nodemailer) return { enviado: false, texto };
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from: process.env.SMTP_FROM ?? to, to, subject: "Reporte TurnoYa", text: texto });
  return { enviado: true, texto };
}
