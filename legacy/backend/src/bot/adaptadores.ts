/**
 * M4 · Adaptadores de proveedor → `MensajeEntrante` (docs/modulos/M4-chatbot-whatsapp.md §6.2).
 * El resto del bot solo conoce este formato; cambiar de proveedor no toca la FSM.
 *
 * OpenWA (verificado contra su OpenAPI): evento `message.received`, `sessionId` en la raíz y en `data`
 * los campos de la familia de mensajes: `id`, `sender`/`from`, `chatId`, `body`, `type`, `isGroup`, `fromMe`, `timestamp`.
 */

export interface MensajeEntrante {
  proveedor: "openwa" | "meta";
  mensajeId: string;
  canalId: string;
  desde: string;
  texto: string;
  tipo: "texto" | "otro";
  tsMs: number;
  esGrupo: boolean;
  propio: boolean;
}

function telefonoDeChat(id: string) {
  const d = id.replace(/@.*/, "").replace(/\D/g, "");
  return d ? `+${d}` : "";
}

function tsMs(t: unknown) {
  const n = typeof t === "string" ? Number(t) : typeof t === "number" ? t : NaN;
  if (!Number.isFinite(n)) return Date.now();
  return n < 1e12 ? n * 1000 : n;
}

export function adaptarOpenWA(body: unknown): MensajeEntrante | null {
  const ev = body as { event?: string; sessionId?: string; session?: string; data?: Record<string, unknown> };
  if (ev?.event !== "message.received" && ev?.event !== "message") return null;
  const d = ev.data ?? {};
  const chat = String(d.chatId ?? d.from ?? d.sender ?? "");
  const remitente = String(d.sender ?? d.from ?? d.chatId ?? "");
  const tipo = String(d.type ?? "chat");
  const texto = String(d.body ?? d.text ?? "");
  return {
    proveedor: "openwa",
    mensajeId: String(d.id ?? d.messageId ?? ""),
    canalId: String(ev.sessionId ?? ev.session ?? d.sessionId ?? ""),
    desde: telefonoDeChat(remitente),
    texto,
    tipo: ["chat", "text", "conversation"].includes(tipo) && texto ? "texto" : "otro",
    tsMs: tsMs(d.timestamp),
    esGrupo: Boolean(d.isGroup) || chat.endsWith("@g.us"),
    propio: Boolean(d.fromMe),
  };
}

export function adaptarMeta(body: unknown): MensajeEntrante[] {
  const m = body as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; messages?: { from: string; id: string; timestamp: string; type: string; text?: { body?: string }; interactive?: { button_reply?: { id?: string; title?: string } } }[] } }[] }[] };
  const out: MensajeEntrante[] = [];
  for (const e of m.entry ?? []) {
    for (const c of e.changes ?? []) {
      for (const msg of c.value?.messages ?? []) {
        const texto = msg.text?.body ?? msg.interactive?.button_reply?.title ?? "";
        out.push({
          proveedor: "meta",
          mensajeId: msg.id,
          canalId: c.value?.metadata?.phone_number_id ?? "",
          desde: telefonoDeChat(msg.from),
          texto,
          tipo: (msg.type === "text" || msg.type === "interactive") && texto ? "texto" : "otro",
          tsMs: tsMs(msg.timestamp),
          esGrupo: false,
          propio: false,
        });
      }
    }
  }
  return out;
}

/** RN-M4-02/03: descarta grupos, mensajes propios y eventos viejos (> 5 min). */
export function motivoDescarte(m: MensajeEntrante, ahoraMs = Date.now()) {
  if (!m.mensajeId || !m.desde) return "INCOMPLETO";
  if (m.esGrupo) return "GRUPO";
  if (m.propio) return "PROPIO";
  if (ahoraMs - m.tsMs > 5 * 60_000) return "VIEJO";
  return null;
}
