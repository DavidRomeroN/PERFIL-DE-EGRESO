import { createHmac, timingSafeEqual } from "crypto";
import { ErrorNegocio } from "@/lib/errores";
import { log } from "@/lib/log";

/**
 * Cliente mínimo de la API de Mercado Pago (Checkout API).
 * El navegador solo tokeniza la tarjeta con el Card Payment Brick (Public Key);
 * el cobro se crea AQUÍ con el Access Token, que nunca sale del servidor.
 */

const API = "https://api.mercadopago.com";

export function configMercadoPago() {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
  return {
    accessToken,
    publicKey: process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY ?? "",
    webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "",
    configurado: accessToken.length > 20,
    /** Solo desarrollo: el cobro no va a /v1/payments; el resultado sale del titular de la tarjeta de prueba (APRO, CONT, OTHE…). */
    simulado: process.env.MERCADOPAGO_SIMULADO === "1" && process.env.NODE_ENV !== "production",
  };
}

const SIMULACION: Record<string, [PagoMP["status"], string]> = {
  APRO: ["approved", "accredited"],
  CONT: ["in_process", "pending_contingency"],
  OTHE: ["rejected", "cc_rejected_other_reason"],
  CALL: ["rejected", "cc_rejected_call_for_authorize"],
  FUND: ["rejected", "cc_rejected_insufficient_amount"],
  SECU: ["rejected", "cc_rejected_bad_filled_security_code"],
  EXPI: ["rejected", "cc_rejected_bad_filled_date"],
  FORM: ["rejected", "cc_rejected_bad_filled_other"],
};

/** Pago simulado: la tarjeta SÍ se tokenizó en Mercado Pago; se lee el titular del token para decidir el resultado. */
async function pagoSimulado(p: { tarjeta: DatosTarjeta; monto: number; referencia: string }): Promise<PagoMP> {
  const { publicKey } = configMercadoPago();
  const t = (await fetch(`${API}/v1/card_tokens/${encodeURIComponent(p.tarjeta.token)}?public_key=${encodeURIComponent(publicKey)}`, { cache: "no-store" })
    .then((r) => r.json())
    .catch(() => ({}))) as { cardholder?: { name?: string }; last_four_digits?: string };
  const [status, status_detail] = SIMULACION[(t.cardholder?.name ?? "").trim().toUpperCase()] ?? SIMULACION.OTHE;
  log.warn("Pago SIMULADO (MERCADOPAGO_SIMULADO=1)", { referencia: p.referencia, status });
  return {
    id: Date.now(),
    status,
    status_detail,
    transaction_amount: p.monto,
    currency_id: "PEN",
    payment_method_id: p.tarjeta.payment_method_id,
    external_reference: p.referencia,
    card: { last_four_digits: t.last_four_digits },
    payer: { email: p.tarjeta.payer.email },
  };
}

/** Datos que entrega el Card Payment Brick en `onSubmit`. */
export interface DatosTarjeta {
  token: string;
  issuer_id?: string | number | null;
  payment_method_id: string;
  transaction_amount?: number;
  installments: number;
  payer: { email: string; identification?: { type: string; number: string } };
}

export interface PagoMP {
  id: number;
  status: "approved" | "in_process" | "pending" | "rejected" | "cancelled" | "refunded" | "charged_back" | "authorized";
  status_detail: string;
  transaction_amount: number;
  currency_id: string;
  payment_method_id: string;
  external_reference: string | null;
  card?: { last_four_digits?: string };
  payer?: { email?: string };
  metadata?: Record<string, unknown>;
}

async function llamar<T>(ruta: string, init: RequestInit & { idempotencia?: string } = {}): Promise<T> {
  const { accessToken, configurado } = configMercadoPago();
  if (!configurado) throw new ErrorNegocio("PAGOS_NO_CONFIGURADOS", "Los pagos no están configurados (falta MERCADOPAGO_ACCESS_TOKEN)", 503);
  const res = await fetch(`${API}${ruta}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.idempotencia ? { "X-Idempotency-Key": init.idempotencia } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; cause?: { description?: string }[] };
  if (!res.ok) {
    const detalle = data.cause?.[0]?.description ?? data.message ?? `HTTP ${res.status}`;
    log.warn("Mercado Pago rechazó la solicitud", { ruta, status: res.status, detalle });
    throw new ErrorNegocio("PAGO_RECHAZADO", `Mercado Pago no aceptó el pago: ${detalle}`, 402);
  }
  return data;
}

/** Crea el cobro con el token de la tarjeta. El monto lo fija SIEMPRE el servidor (precio del plan). */
export function crearPago(p: { tarjeta: DatosTarjeta; monto: number; descripcion: string; referencia: string; idempotencia: string; urlNotificacion?: string }) {
  if (configMercadoPago().simulado) return pagoSimulado(p);
  return llamar<PagoMP>("/v1/payments", {
    method: "POST",
    idempotencia: p.idempotencia,
    body: JSON.stringify({
      transaction_amount: p.monto,
      token: p.tarjeta.token,
      description: p.descripcion,
      installments: Math.max(1, Math.min(12, Number(p.tarjeta.installments) || 1)),
      payment_method_id: p.tarjeta.payment_method_id,
      ...(p.tarjeta.issuer_id ? { issuer_id: Number(p.tarjeta.issuer_id) } : {}),
      payer: { email: p.tarjeta.payer.email, ...(p.tarjeta.payer.identification?.number ? { identification: p.tarjeta.payer.identification } : {}) },
      external_reference: p.referencia,
      statement_descriptor: "TURNOYA",
      ...(p.urlNotificacion ? { notification_url: p.urlNotificacion } : {}),
    }),
  });
}

export function obtenerPago(id: string | number) {
  return llamar<PagoMP>(`/v1/payments/${encodeURIComponent(String(id))}`);
}

/**
 * Verifica la cabecera `x-signature` del webhook: `ts=…,v1=…` con
 * HMAC-SHA256(secret, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;").
 * Sin secreto configurado se acepta (el pago se vuelve a consultar a la API igualmente).
 */
export function firmaWebhookValida(firma: string | null, requestId: string | null, dataId: string, secreto: string) {
  if (!secreto) return true;
  if (!firma) return false;
  const partes = Object.fromEntries(firma.split(",").map((x) => x.trim().split("=") as [string, string]));
  if (!partes.ts || !partes.v1) return false;
  const manifiesto = `id:${dataId.toLowerCase()};request-id:${requestId ?? ""};ts:${partes.ts};`;
  const esperado = createHmac("sha256", secreto).update(manifiesto).digest("hex");
  const a = Buffer.from(esperado);
  const b = Buffer.from(partes.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const ESTADOS: Record<PagoMP["status"], "APROBADO" | "EN_PROCESO" | "PENDIENTE" | "RECHAZADO" | "CANCELADO" | "REEMBOLSADO"> = {
  approved: "APROBADO",
  authorized: "EN_PROCESO",
  in_process: "EN_PROCESO",
  pending: "PENDIENTE",
  rejected: "RECHAZADO",
  cancelled: "CANCELADO",
  refunded: "REEMBOLSADO",
  charged_back: "REEMBOLSADO",
};

/** Mensajes amigables para los motivos de rechazo más comunes. */
export function mensajeRechazo(detalle: string) {
  const m: Record<string, string> = {
    cc_rejected_insufficient_amount: "La tarjeta no tiene saldo suficiente.",
    cc_rejected_bad_filled_security_code: "El código de seguridad no es correcto.",
    cc_rejected_bad_filled_date: "La fecha de vencimiento no es correcta.",
    cc_rejected_bad_filled_other: "Revisa los datos de la tarjeta.",
    cc_rejected_call_for_authorize: "Tu banco pide que autorices el pago. Llámalo y vuelve a intentar.",
    cc_rejected_card_disabled: "La tarjeta está inactiva. Actívala con tu banco.",
    cc_rejected_duplicated_payment: "Ya hiciste un pago igual hace un momento.",
    cc_rejected_high_risk: "El pago fue rechazado por seguridad. Prueba con otra tarjeta.",
    cc_rejected_other_reason: "El banco rechazó el pago. Prueba con otra tarjeta.",
  };
  if (m[detalle]) return m[detalle];
  // Errores de la API (credenciales, validación) ya vienen como texto legible
  return detalle.startsWith("Mercado Pago") ? detalle : "El pago fue rechazado. Prueba con otra tarjeta.";
}
