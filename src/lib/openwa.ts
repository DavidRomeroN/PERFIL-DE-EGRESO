/**
 * Cliente mínimo para OpenWA (https://github.com/rmyndharis/OpenWA):
 * gateway de WhatsApp open source y auto-hospedado. Se usa como proveedor
 * "openwa" en la estrategia de notificaciones y desde el panel de administración
 * para vincular el número (QR), registrar el webhook de estados y enviar pruebas.
 *
 * Variables de entorno:
 *  OPENWA_URL             URL base del gateway (p. ej. http://localhost:2785)
 *  OPENWA_API_KEY         API key (X-API-Key). Con docker compose se siembra con API_MASTER_KEY.
 *  OPENWA_SESSION         Nombre de la sesión de WhatsApp (por defecto "turnoya")
 *  OPENWA_WEBHOOK_SECRET  Secreto HMAC para validar X-OpenWA-Signature (≥16 caracteres)
 */

export type EstadoSesionOpenWA = "created" | "initializing" | "qr_ready" | "authenticating" | "ready" | "disconnected" | "action_required" | "failed";

export interface SesionOpenWA {
  id: string;
  name: string;
  status: EstadoSesionOpenWA;
  phone?: string | null;
  pushName?: string | null;
  connectedAt?: string | null;
  lastError?: string | null;
  engineLoaded?: boolean;
}

export interface EstadoOpenWA {
  configurado: boolean;
  url: string;
  sesion: string;
  alcanzable: boolean;
  estado: EstadoSesionOpenWA | "sin_sesion" | "sin_configurar";
  telefono: string | null;
  nombre: string | null;
  qr: string | null;
  error: string | null;
  webhookRegistrado: boolean;
  webhookUrl: string;
}

export class ErrorOpenWA extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export function configOpenWA() {
  const url = (process.env.OPENWA_URL ?? "http://localhost:2785").replace(/\/$/, "");
  const apiKey = process.env.OPENWA_API_KEY ?? "";
  const sesion = (process.env.OPENWA_SESSION ?? "turnoya").trim();
  const webhookSecret = process.env.OPENWA_WEBHOOK_SECRET ?? "";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  // Si la app también corre en Docker, OpenWA debe alcanzar al contenedor por su nombre de servicio.
  const webhookUrl = `${(process.env.OPENWA_WEBHOOK_BASE_URL ?? appUrl).replace(/\/$/, "")}/api/v1/webhooks/whatsapp`;
  return { url, apiKey, sesion, webhookSecret, webhookUrl, configurado: Boolean(apiKey) };
}

async function llamar<T>(ruta: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const { url, apiKey } = configOpenWA();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api${ruta}`, {
      ...init,
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey, ...(init.headers ?? {}) },
      signal: ctrl.signal,
      cache: "no-store",
    });
    const texto = await res.text();
    const data = texto ? (JSON.parse(texto) as unknown) : null;
    if (!res.ok) {
      const d = data as { message?: string | string[]; error?: string } | null;
      const msg = Array.isArray(d?.message) ? d.message.join(", ") : (d?.message ?? d?.error ?? `HTTP ${res.status}`);
      throw new ErrorOpenWA(msg, res.status);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ErrorOpenWA) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new ErrorOpenWA("OpenWA no respondió a tiempo", 504);
    throw new ErrorOpenWA(e instanceof Error ? `No se pudo conectar con OpenWA (${e.message})` : "No se pudo conectar con OpenWA", 502);
  } finally {
    clearTimeout(timer);
  }
}

/** Convierte +51987654321 → 51987654321@c.us */
export function chatIdDesdeE164(telefonoE164: string) {
  return `${telefonoE164.replace(/\D/g, "")}@c.us`;
}

export async function listarSesiones() {
  const r = await llamar<SesionOpenWA[] | { data: SesionOpenWA[] }>("/sessions");
  return Array.isArray(r) ? r : (r.data ?? []);
}

export async function buscarSesion(): Promise<SesionOpenWA | null> {
  const { sesion } = configOpenWA();
  const lista = await listarSesiones();
  return lista.find((s) => s.name === sesion || s.id === sesion) ?? null;
}

export async function asegurarSesion(): Promise<SesionOpenWA> {
  const existente = await buscarSesion();
  if (existente) return existente;
  const { sesion } = configOpenWA();
  return llamar<SesionOpenWA>("/sessions", { method: "POST", body: JSON.stringify({ name: sesion }) });
}

export async function iniciarSesion(): Promise<SesionOpenWA> {
  const s = await asegurarSesion();
  if (s.status === "ready" || s.status === "qr_ready" || s.status === "initializing" || s.status === "authenticating") return s;
  try {
    await llamar(`/sessions/${encodeURIComponent(s.id)}/start`, { method: "POST" }, 60_000);
  } catch (e) {
    // 400/409 = ya iniciada o en transición; no es un error para el usuario
    if (!(e instanceof ErrorOpenWA && (e.status === 400 || e.status === 409))) throw e;
  }
  return (await buscarSesion()) ?? s;
}

export async function detenerSesion(logout = false) {
  const s = await buscarSesion();
  if (!s) return;
  await llamar(`/sessions/${encodeURIComponent(s.id)}/${logout ? "logout" : "stop"}`, { method: "POST" }, 60_000).catch((e) => {
    if (!(e instanceof ErrorOpenWA && (e.status === 400 || e.status === 409))) throw e;
  });
}

export async function obtenerQr(sesionId: string): Promise<string | null> {
  try {
    const r = await llamar<{ qrCode: string; status: string }>(`/sessions/${encodeURIComponent(sesionId)}/qr`);
    return r.qrCode ?? null;
  } catch {
    return null;
  }
}

interface WebhookOpenWA {
  id: string;
  url: string;
  events: string[];
  isActive?: boolean;
}

export async function webhookRegistrado(sesionId: string): Promise<WebhookOpenWA | null> {
  const { webhookUrl } = configOpenWA();
  try {
    const r = await llamar<WebhookOpenWA[] | { data: WebhookOpenWA[] }>(`/sessions/${encodeURIComponent(sesionId)}/webhooks`);
    const lista = Array.isArray(r) ? r : (r.data ?? []);
    return lista.find((w) => w.url === webhookUrl) ?? null;
  } catch {
    return null;
  }
}

/** Registra (o reutiliza) el webhook de acks → /api/v1/webhooks/whatsapp */
export async function registrarWebhook(): Promise<WebhookOpenWA> {
  const s = await asegurarSesion();
  const existente = await webhookRegistrado(s.id);
  if (existente) return existente;
  const { webhookUrl, webhookSecret } = configOpenWA();
  return llamar<WebhookOpenWA>(`/sessions/${encodeURIComponent(s.id)}/webhooks`, {
    method: "POST",
    body: JSON.stringify({
      url: webhookUrl,
      events: ["message.received", "message.ack", "message.failed", "session.status"],
      ...(webhookSecret.length >= 16 ? { secret: webhookSecret } : {}),
      retryCount: 3,
    }),
  });
}

/** Envía un texto. Devuelve el messageId del gateway. */
export async function enviarTexto(telefonoE164: string, texto: string): Promise<{ messageId: string }> {
  const s = await buscarSesion();
  if (!s) throw new ErrorOpenWA(`La sesión "${configOpenWA().sesion}" no existe en OpenWA. Vincula el número desde Admin → Avisos WhatsApp.`, 409);
  if (s.status !== "ready") throw new ErrorOpenWA(`La sesión de WhatsApp no está conectada (estado: ${s.status})`, 409);
  const r = await llamar<{ messageId: string; timestamp: number }>(`/sessions/${encodeURIComponent(s.id)}/messages/send-text`, {
    method: "POST",
    body: JSON.stringify({ chatId: chatIdDesdeE164(telefonoE164), text: texto }),
  });
  return { messageId: r.messageId };
}

/** Estado consolidado para el panel de administración. */
export async function estadoOpenWA(): Promise<EstadoOpenWA> {
  const cfg = configOpenWA();
  const base: EstadoOpenWA = {
    configurado: cfg.configurado,
    url: cfg.url,
    sesion: cfg.sesion,
    alcanzable: false,
    estado: cfg.configurado ? "sin_sesion" : "sin_configurar",
    telefono: null,
    nombre: null,
    qr: null,
    error: null,
    webhookRegistrado: false,
    webhookUrl: cfg.webhookUrl,
  };
  if (!cfg.configurado) return base;
  try {
    const s = await buscarSesion();
    base.alcanzable = true;
    if (!s) return base;
    base.estado = s.status;
    base.telefono = s.phone ?? null;
    base.nombre = s.pushName ?? null;
    base.error = s.lastError ?? null;
    if (s.status === "qr_ready") base.qr = await obtenerQr(s.id);
    base.webhookRegistrado = Boolean(await webhookRegistrado(s.id));
    return base;
  } catch (e) {
    base.error = e instanceof Error ? e.message : "Error desconocido";
    return base;
  }
}
