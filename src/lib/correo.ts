import nodemailer from "nodemailer";
import { log } from "@/lib/log";

/**
 * Envío de correo por SMTP (nodemailer, D12). Variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 * Sin SMTP configurado no falla: devuelve `{ enviado: false }` y el reporte queda disponible para descarga.
 */

export function smtpConfigurado() {
  return !!process.env.SMTP_HOST;
}

let transporte: nodemailer.Transporter | null = null;
function transporter() {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporte;
}

export function escaparHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface Correo {
  para: string[];
  asunto: string;
  texto: string;
  html?: string;
  adjuntos?: { nombre: string; contenido: Buffer | string; tipo: string }[];
}

export async function enviarCorreo(c: Correo): Promise<{ enviado: boolean; error?: string }> {
  const destinatarios = c.para.filter((d) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d));
  if (!smtpConfigurado() || destinatarios.length === 0) return { enviado: false, error: smtpConfigurado() ? "Sin destinatarios válidos" : "SMTP no configurado" };
  try {
    await transporter().sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "turnoya@localhost",
      to: destinatarios.join(", "),
      subject: c.asunto,
      text: c.texto,
      html: c.html,
      attachments: c.adjuntos?.map((a) => ({ filename: a.nombre, content: a.contenido, contentType: a.tipo })),
    });
    return { enviado: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.warn("correo no enviado", { error });
    return { enviado: false, error };
  }
}
