"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Card Payment Brick de Mercado Pago (Checkout API): el formulario de tarjeta se dibuja dentro de la página,
 * tokeniza la tarjeta en el navegador con la Public Key y entrega los datos a `onPagar`. El cobro lo hace el servidor.
 * SDK: https://sdk.mercadopago.com/js/v2
 */

export interface DatosTarjetaBrick {
  token: string;
  issuer_id?: string | number | null;
  payment_method_id: string;
  transaction_amount?: number;
  installments: number;
  payer: { email: string; identification?: { type: string; number: string } };
}

interface BrickController {
  unmount: () => void;
}
interface MercadoPagoSdk {
  bricks: () => { create: (tipo: "cardPayment", contenedor: string, opciones: unknown) => Promise<BrickController> };
}
declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, opciones?: { locale?: string }) => MercadoPagoSdk;
  }
}

let cargaSdk: Promise<void> | null = null;
function cargarSdk() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.MercadoPago) return Promise.resolve();
  cargaSdk ??= new Promise<void>((ok, mal) => {
    const s = document.createElement("script");
    s.src = "https://sdk.mercadopago.com/js/v2";
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => {
      cargaSdk = null;
      mal(new Error("No se pudo cargar el formulario de pago de Mercado Pago"));
    };
    document.head.appendChild(s);
  });
  return cargaSdk;
}

export function TarjetaMercadoPago({ monto, email, onPagar, deshabilitado }: { monto: number; email?: string; onPagar: (d: DatosTarjetaBrick) => Promise<void>; deshabilitado?: boolean }) {
  const id = `mp-brick-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const pagarRef = useRef(onPagar);
  useEffect(() => {
    pagarRef.current = onPagar;
  });
  const publicKey = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY ?? "";

  useEffect(() => {
    if (!publicKey || deshabilitado) return;
    let controlador: BrickController | null = null;
    let vivo = true;
    cargarSdk()
      .then(async () => {
        if (!vivo || !window.MercadoPago) return;
        const mp = new window.MercadoPago(publicKey, { locale: "es-PE" });
        controlador = await mp.bricks().create("cardPayment", id, {
          initialization: { amount: monto, payer: email ? { email } : undefined },
          customization: { visual: { style: { theme: "default" } }, paymentMethods: { maxInstallments: 1 } },
          callbacks: {
            onReady: () => setListo(true),
            onSubmit: (datos: DatosTarjetaBrick) => pagarRef.current(datos),
            onError: (e: { message?: string }) => setError(e?.message ?? "Error en el formulario de pago"),
          },
        });
        if (!vivo) controlador.unmount();
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      vivo = false;
      controlador?.unmount();
    };
  }, [publicKey, monto, email, id, deshabilitado]);

  if (!publicKey) return <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Los pagos no están configurados (falta NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY).</p>;
  return (
    <div>
      {!listo && !error && <div className="h-40 animate-pulse rounded-xl bg-muted" aria-busy="true" aria-label="Cargando formulario de pago" />}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <div id={id} />
      <p className="mt-2 text-center text-xs text-muted-foreground">Pago seguro procesado por Mercado Pago. TurnoYa no guarda los datos de tu tarjeta.</p>
    </div>
  );
}
