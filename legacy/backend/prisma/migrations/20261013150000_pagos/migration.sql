-- Pagos de suscripción con Mercado Pago (Checkout API / Card Payment Brick).
CREATE TYPE "EstadoPago" AS ENUM ('PENDIENTE', 'APROBADO', 'EN_PROCESO', 'RECHAZADO', 'CANCELADO', 'REEMBOLSADO');

ALTER TABLE "local" ADD COLUMN "plan_vence_at" TIMESTAMP(3);

CREATE TABLE "pago" (
  "id"                SERIAL PRIMARY KEY,
  "local_id"          INTEGER REFERENCES "local"("id") ON DELETE SET NULL,
  "plan_id"           INTEGER NOT NULL REFERENCES "plan"("id"),
  "proveedor"         TEXT NOT NULL DEFAULT 'mercadopago',
  "proveedor_pago_id" TEXT UNIQUE,
  "clave_idem"        TEXT NOT NULL UNIQUE,
  "estado"            "EstadoPago" NOT NULL DEFAULT 'PENDIENTE',
  "estado_detalle"    TEXT,
  "monto"             DECIMAL(10,2) NOT NULL,
  "moneda"            TEXT NOT NULL DEFAULT 'PEN',
  "meses"             INTEGER NOT NULL DEFAULT 1,
  "metodo"            TEXT,
  "ultimos4"          TEXT,
  "email_pagador"     TEXT,
  -- Registro pendiente (pago en proceso): datos del local y del admin con la contraseña ya hasheada
  "registro"          JSONB,
  "aplicado_at"       TIMESTAMP(3),
  "creado_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "pago_local_idx" ON "pago" ("local_id", "creado_at");
