import type { NextRequest } from "next/server";
import { configMercadoPago, firmaWebhookValida } from "@backend/pagos/mercadopago";
import { procesarNotificacion } from "@backend/pagos/service";
import { log } from "@backend/log";

/**
 * POST /api/v1/webhooks/mercadopago — notificaciones de pagos (tipo `payment`).
 * Se verifica la firma `x-signature` (si hay MERCADOPAGO_WEBHOOK_SECRET) y SIEMPRE se vuelve a consultar el pago a la API.
 * Responde 200 rápido para que Mercado Pago no reintente.
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as { type?: string; action?: string; data?: { id?: string | number } };
  const dataId = String(body.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
  const tipo = body.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
  if (!dataId || (tipo && tipo !== "payment")) return Response.json({ ok: true, ignorado: true });
  if (!firmaWebhookValida(req.headers.get("x-signature"), req.headers.get("x-request-id"), dataId, configMercadoPago().webhookSecret)) {
    return new Response("Firma inválida", { status: 401 });
  }
  try {
    const r = await procesarNotificacion(dataId);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    log.error("webhook de Mercado Pago", { error: e instanceof Error ? e.message : String(e) });
    return Response.json({ ok: false }, { status: 500 });
  }
}
