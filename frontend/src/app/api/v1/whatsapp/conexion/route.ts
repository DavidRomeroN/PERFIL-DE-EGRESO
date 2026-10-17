import { z } from "zod";
import { conRol, error, ok, parseBody } from "@backend/api";
import { normalizarTelefono } from "@backend/crypto";
import { registrarAuditoria } from "@backend/admin";
import { detenerSesion, enviarTexto, ErrorOpenWA, estadoOpenWA, iniciarSesion, registrarWebhook } from "@backend/openwa";
import { nombreProveedorActivo } from "@backend/whatsapp";

/**
 * Conexión del gateway OpenWA (proveedor "openwa").
 *  GET  → estado de la sesión (incluye QR en base64 cuando hay que escanear) y del webhook
 *  POST → { accion: "iniciar" | "webhook" | "detener" | "desvincular" | "prueba", telefono? }
 */
export const GET = conRol(["SUPER_ADMIN", "ADMIN_LOCAL"], async () => {
  const estado = await estadoOpenWA();
  return ok({ proveedor: nombreProveedorActivo(), ...estado });
});

const accionSchema = z.object({
  accion: z.enum(["iniciar", "webhook", "detener", "desvincular", "prueba"]),
  telefono: z.string().trim().optional(),
});

export const POST = conRol(["SUPER_ADMIN", "ADMIN_LOCAL"], async (req, { session }) => {
  const { accion, telefono } = await parseBody(req, accionSchema);
  try {
    switch (accion) {
      case "iniciar": {
        const s = await iniciarSesion();
        await registrarAuditoria({ usuarioId: session.sub, localId: session.localId ?? null, accion: "WHATSAPP_INICIAR_SESION", entidad: "openwa", entidadId: s.id });
        break;
      }
      case "webhook":
        await registrarWebhook();
        break;
      case "detener":
        await detenerSesion(false);
        break;
      case "desvincular":
        await detenerSesion(true);
        await registrarAuditoria({ usuarioId: session.sub, localId: session.localId ?? null, accion: "WHATSAPP_DESVINCULAR", entidad: "openwa", entidadId: null });
        break;
      case "prueba": {
        const e164 = telefono ? normalizarTelefono(telefono) : null;
        if (!e164) return error("TELEFONO_INVALIDO", "Ingresa un celular válido (9 dígitos, ej. 951234567)", 422);
        const r = await enviarTexto(e164, `✅ *TurnoYa* conectado correctamente.\nEste número enviará los avisos de turno de ${session.localNombre ?? "tu local"}.`);
        return ok({ enviado: true, messageId: r.messageId, ...(await estadoOpenWA()) });
      }
    }
    return ok(await estadoOpenWA());
  } catch (e) {
    if (e instanceof ErrorOpenWA) return error("OPENWA", e.message, e.status >= 400 && e.status < 600 ? e.status : 502);
    throw e;
  }
});
