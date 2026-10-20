CREATE OR REPLACE FUNCTION calcular_clave_orden(peso double precision, emitido timestamptz, alfa double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT peso - alfa * (EXTRACT(EPOCH FROM (emitido - TIMESTAMPTZ '2026-01-01')) / 60.0);
$$;

CREATE TABLE IF NOT EXISTS "job_interno" (
  "id" SERIAL PRIMARY KEY,
  "nombre" TEXT NOT NULL,
  "correr_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hecho_en" TIMESTAMPTZ
);
