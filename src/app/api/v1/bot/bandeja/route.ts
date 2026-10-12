import { z } from "zod";
import { conRol, ok, parseBody } from "@/lib/api";
import { listarBandeja, marcarRespondido } from "@/lib/bot/bandeja";
import { proveedorWhatsApp } from "@/lib/whatsapp";

export const GET = conRol(["ADMIN_LOCAL", "SUPER_ADMIN", "OPERADOR"], async () => ok(listarBandeja()));

const schema = z.object({ id: z.number().int(), texto: z.string().min(1).max(500) });

export const POST = conRol(["ADMIN_LOCAL", "SUPER_ADMIN", "OPERADOR"], async (req) => {
  const body = await parseBody(req, schema);
  const m = marcarRespondido(body.id, body.texto);
  if (!m) return ok({ enviado: false });
  await proveedorWhatsApp().enviar({ telefonoE164: m.telefono, plantilla: "bot", parametros: [], textoRenderizado: body.texto });
  return ok({ enviado: true });
});
