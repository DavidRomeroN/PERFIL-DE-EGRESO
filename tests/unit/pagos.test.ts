import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { ESTADOS, firmaWebhookValida, mensajeRechazo } from "../../src/lib/pagos/mercadopago";

const secreto = "secreto-de-prueba";
const firmar = (dataId: string, requestId: string, ts: string) =>
  `ts=${ts},v1=${createHmac("sha256", secreto).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex")}`;

test("webhook: acepta la firma correcta y rechaza la alterada", () => {
  const firma = firmar("123456", "req-1", "1760000000");
  assert.equal(firmaWebhookValida(firma, "req-1", "123456", secreto), true);
  assert.equal(firmaWebhookValida(firma, "req-1", "999999", secreto), false);
  assert.equal(firmaWebhookValida(firma, "req-2", "123456", secreto), false);
  assert.equal(firmaWebhookValida(null, "req-1", "123456", secreto), false);
  assert.equal(firmaWebhookValida("ts=1", "req-1", "123456", secreto), false);
});

test("webhook: sin secreto configurado no se verifica (solo desarrollo)", () => {
  assert.equal(firmaWebhookValida(null, null, "1", ""), true);
});

test("estados de Mercado Pago se traducen a EstadoPago", () => {
  assert.equal(ESTADOS.approved, "APROBADO");
  assert.equal(ESTADOS.rejected, "RECHAZADO");
  assert.equal(ESTADOS.in_process, "EN_PROCESO");
  assert.equal(ESTADOS.refunded, "REEMBOLSADO");
});

test("mensajes de rechazo en español y con respaldo genérico", () => {
  assert.match(mensajeRechazo("cc_rejected_insufficient_amount"), /saldo/i);
  assert.ok(mensajeRechazo("motivo_desconocido").length > 10);
});
