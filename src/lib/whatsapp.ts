import { enviarTexto as openwaEnviarTexto } from "@/lib/openwa";

/**
 * Estrategia de proveedores de notificación (ADR-04 / patrón estrategia).
 *  - mock:   simulador integrado (ideal para demo y pruebas; no envía nada real)
 *  - openwa: gateway open source auto-hospedado (OpenWA) con un número propio
 *            vinculado por QR; envía el texto renderizado y recibe acks por webhook
 *  - meta:   WhatsApp Cloud API oficial con plantilla aprobada `turno_proximo`
 */

export type NombreProveedor = "mock" | "openwa" | "meta";

export interface EnvioWhatsApp {
  telefonoE164: string;
  plantilla: string;
  parametros: string[];
  textoRenderizado: string;
}

export interface ResultadoEnvio {
  ok: boolean;
  proveedorMsgId?: string;
  error?: string;
}

export interface ProveedorWhatsApp {
  nombre: NombreProveedor;
  enviar(envio: EnvioWhatsApp): Promise<ResultadoEnvio>;
}

const openwa: ProveedorWhatsApp = {
  nombre: "openwa",
  async enviar(envio) {
    try {
      const r = await openwaEnviarTexto(envio.telefonoE164, envio.textoRenderizado);
      return { ok: true, proveedorMsgId: r.messageId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Error al enviar por OpenWA" };
    }
  },
};

const mock: ProveedorWhatsApp = {
  nombre: "mock",
  async enviar() {
    await new Promise((r) => setTimeout(r, 120));
    return { ok: true, proveedorMsgId: `wamid.MOCK.${Date.now().toString(36)}` };
  },
};

const meta: ProveedorWhatsApp = {
  nombre: "meta",
  async enviar(envio) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) return { ok: false, error: "WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurados" };
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: envio.telefonoE164.replace("+", ""),
          type: "template",
          template: {
            name: envio.plantilla,
            language: { code: "es" },
            components: [
              { type: "body", parameters: envio.parametros.map((text) => ({ type: "text", text })) },
            ],
          },
        }),
      });
      const data = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
      if (!res.ok) return { ok: false, error: data.error?.message ?? `HTTP ${res.status}` };
      return { ok: true, proveedorMsgId: data.messages?.[0]?.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Error de red" };
    }
  },
};

export function nombreProveedorActivo(): NombreProveedor {
  const v = (process.env.WHATSAPP_PROVIDER ?? "mock").toLowerCase();
  return v === "meta" || v === "openwa" ? v : "mock";
}

export function proveedorWhatsApp(): ProveedorWhatsApp {
  const n = nombreProveedorActivo();
  return n === "meta" ? meta : n === "openwa" ? openwa : mock;
}

/** Plantilla `turno_proximo` (texto equivalente a la plantilla aprobada en Meta). */
export function renderTurnoProximo(p: { nombre?: string | null; codigo: string; local: string; faltan: number; url: string }) {
  const saludo = p.nombre ? `Hola ${p.nombre.split(" ")[0]} 👋` : "Hola 👋";
  const faltan = p.faltan <= 0 ? "ya casi es tu turno" : p.faltan === 1 ? "falta 1 persona" : `faltan ${p.faltan} personas`;
  return `${saludo}, tu turno *${p.codigo}* en *${p.local}* está por llegar: ${faltan}. Acércate a la sala. Sigue tu turno aquí: ${p.url}`;
}

export function renderTurnoLlamado(p: { codigo: string; ventanilla: string; local: string }) {
  return `📣 *${p.codigo}*, es tu turno en *${p.local}*. Acércate a *${p.ventanilla}*.`;
}
