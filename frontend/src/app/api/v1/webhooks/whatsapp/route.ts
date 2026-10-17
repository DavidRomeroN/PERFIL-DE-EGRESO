import type { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@backend/db";
import { publicar } from "@backend/realtime";
import { configOpenWA } from "@backend/openwa";
import { adaptarMeta, adaptarOpenWA } from "@backend/bot/adaptadores";
import { procesarEntrante } from "@backend/bot/service";
import { log } from "@backend/log";

/**
 * Webhook de estados de entrega de WhatsApp. Acepta dos formatos:
 *  - Meta Cloud API: GET handshake (hub.challenge) y POST `entry[].changes[].value.statuses[]`
 *    firmado con X-Hub-Signature-256 (WHATSAPP_APP_SECRET).
 *  - OpenWA: POST `{ event: "message.ack" | "message.failed", data: { messageId, status } }`
 *    firmado con X-OpenWA-Signature (OPENWA_WEBHOOK_SECRET).
 * En ambos casos se actualiza `notificacion.estado` y se publica el evento en tiempo real.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === (process.env.WHATSAPP_VERIFY_TOKEN ?? "turnoya-verify")) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

type EstadoNotif = "PENDIENTE" | "ENVIADO" | "ENTREGADO" | "LEIDO" | "FALLIDO";
const MAPA: Record<string, EstadoNotif> = {
  pending: "PENDIENTE",
  sent: "ENVIADO",
  delivered: "ENTREGADO",
  read: "LEIDO",
  played: "LEIDO",
  failed: "FALLIDO",
};
const ORDEN: Record<EstadoNotif, number> = { PENDIENTE: 0, ENVIADO: 1, ENTREGADO: 2, LEIDO: 3, FALLIDO: 9 };

function firmaValida(raw: string, firma: string | null, secret: string) {
  if (!firma) return false;
  const esperada = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function aplicarEstado(proveedorMsgId: string, nuevo: EstadoNotif, error?: string | null) {
  const n = await prisma.notificacion.findFirst({ where: { proveedorMsgId }, include: { turno: { select: { localId: true } } } });
  if (!n) return false;
  // No retroceder (p. ej. un "sent" tardío después de "delivered")
  if (nuevo !== "FALLIDO" && ORDEN[nuevo] <= ORDEN[n.estado as EstadoNotif]) return true;
  const actualizado = await prisma.notificacion.update({
    where: { id: n.id },
    data: { estado: nuevo, error: nuevo === "FALLIDO" ? (error ?? "Fallo de entrega") : null },
  });
  const localId = n.localId ?? n.turno?.localId;
  if (localId && actualizado.turnoId) {
    publicar({
      tipo: "notificacion:nueva",
      localId,
      notificacion: { id: actualizado.id, turnoId: actualizado.turnoId, mensaje: actualizado.mensaje, destino: actualizado.destino },
    });
  }
  return true;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  // ---------------- OpenWA ----------------
  const firmaOpenWA = req.headers.get("x-openwa-signature");
  const esOpenWA = firmaOpenWA !== null || (typeof body === "object" && body !== null && "event" in body && "sessionId" in body);
  if (esOpenWA) {
    const { webhookSecret } = configOpenWA();
    if (webhookSecret && !firmaValida(raw, firmaOpenWA, webhookSecret)) {
      return new Response("Firma inválida", { status: 401 });
    }
    const ev = body as { event: string; data?: { id?: string; messageId?: string; status?: string; ack?: number; error?: string; reason?: string } };
    // M4: mensaje entrante → bot (se responde 200 de inmediato y se procesa aparte, RNF-M4-03)
    const entrante = adaptarOpenWA(body);
    if (entrante) {
      void procesarEntrante(entrante).catch((e) => log.error("bot: fallo al procesar", { modulo: "M4", error: String(e) }));
    }
    if (ev.event === "message.ack" || ev.event === "message.failed") {
      const d = ev.data ?? {};
      const msgId = d.messageId ?? d.id;
      const status = ev.event === "message.failed" ? "failed" : (d.status ?? ackLegacy(d.ack));
      if (msgId && status) await aplicarEstado(msgId, MAPA[status] ?? "ENVIADO", d.error ?? d.reason);
    }
    // session.status y otros eventos se aceptan sin acción (OpenWA marca la entrega como exitosa)
    return Response.json({ ok: true });
  }

  // ---------------- Meta Cloud API ----------------
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret && !firmaValida(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return new Response("Firma inválida", { status: 401 });
  }
  for (const m of adaptarMeta(body)) {
    void procesarEntrante(m).catch((e) => log.error("bot: fallo al procesar", { modulo: "M4", error: String(e) }));
  }
  type Status = { id: string; status: "sent" | "delivered" | "read" | "failed"; errors?: { title?: string }[] };
  const meta = body as { entry?: { changes?: { value?: { statuses?: Status[] } }[] }[] };
  for (const entry of meta.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const st of change.value?.statuses ?? []) {
        await aplicarEstado(st.id, MAPA[st.status] ?? "ENVIADO", st.errors?.[0]?.title);
      }
    }
  }
  return new Response("OK", { status: 200 });
}

/** Compatibilidad con el entero `ack` heredado de whatsapp-web.js. */
function ackLegacy(ack?: number): string | undefined {
  if (ack === undefined || ack === null) return undefined;
  if (ack < 0) return "failed";
  return (["pending", "sent", "delivered", "read", "played"] as const)[Math.min(ack, 4)];
}
