-- ---------------------------------------------------------------------------
-- M1 · Prioridades (columnas que faltaban) y M3 · Citas con slots atómicos.
-- Cierra D6 (datos de citas en claro) y D7 (sobrecupo y PIN débil).
-- ---------------------------------------------------------------------------

-- M1 ------------------------------------------------------------------------
ALTER TABLE "categoria_prioridad" ADD COLUMN "icono" TEXT;
ALTER TABLE "categoria_prioridad" ADD COLUMN "espera_max_seg" INTEGER;
ALTER TABLE "config_prioridad" ADD COLUMN "actualizado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "categoria_prioridad" SET "espera_max_seg" = 1800 WHERE "codigo" IN ('ADULTO_MAYOR', 'GESTANTE', 'DISCAPACIDAD') AND "espera_max_seg" IS NULL;
UPDATE "categoria_prioridad" SET "espera_max_seg" = 0 WHERE "codigo" = 'EMERGENCIA' AND "espera_max_seg" IS NULL;

-- M3 ------------------------------------------------------------------------
ALTER TYPE "EstadoCita" ADD VALUE IF NOT EXISTS 'ATENDIDA';
CREATE TYPE "CanalCita" AS ENUM ('WEB', 'BOT', 'ADMIN', 'KIOSCO');

CREATE TABLE "config_citas" (
  "cola_id"               INTEGER PRIMARY KEY REFERENCES "cola"("id") ON DELETE CASCADE,
  "activo"                BOOLEAN NOT NULL DEFAULT false,
  "duracion_slot_min"     INTEGER NOT NULL DEFAULT 15,
  "cuota_citas_pct"       INTEGER NOT NULL DEFAULT 60,
  "capacidad_fija"        INTEGER,
  "anticipacion_min_min"  INTEGER NOT NULL DEFAULT 60,
  "anticipacion_max_dias" INTEGER NOT NULL DEFAULT 14,
  "checkin_antes_min"     INTEGER NOT NULL DEFAULT 10,
  "checkin_despues_min"   INTEGER NOT NULL DEFAULT 15,
  "gracia_no_show_min"    INTEGER NOT NULL DEFAULT 10,
  "max_no_show"           INTEGER NOT NULL DEFAULT 3,
  "bloqueo_dias"          INTEGER NOT NULL DEFAULT 30,
  "peso_cita"             INTEGER NOT NULL DEFAULT 40,
  "recordatorios_min"     INTEGER[] NOT NULL DEFAULT ARRAY[1440, 120],
  CONSTRAINT ck_config_citas CHECK (duracion_slot_min BETWEEN 5 AND 240 AND cuota_citas_pct BETWEEN 1 AND 100)
);

CREATE TABLE "bloqueo_agenda" (
  "id"       SERIAL PRIMARY KEY,
  "local_id" INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "cola_id"  INTEGER REFERENCES "cola"("id") ON DELETE CASCADE,
  "inicio"   TIMESTAMP(3) NOT NULL,
  "fin"      TIMESTAMP(3) NOT NULL,
  "motivo"   TEXT NOT NULL,
  CONSTRAINT ck_bloqueo_rango CHECK (fin > inicio)
);
CREATE INDEX "bloqueo_agenda_local_inicio_idx" ON "bloqueo_agenda" ("local_id", "inicio");

CREATE TABLE "slot" (
  "id"         SERIAL PRIMARY KEY,
  "cola_id"    INTEGER NOT NULL REFERENCES "cola"("id") ON DELETE CASCADE,
  "inicio"     TIMESTAMP(3) NOT NULL,
  "fin"        TIMESTAMP(3) NOT NULL,
  "capacidad"  INTEGER NOT NULL,
  "reservados" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT ck_slot_cupo CHECK (reservados >= 0 AND reservados <= capacidad),
  UNIQUE ("cola_id", "inicio")
);

CREATE TABLE "bloqueo_cliente" (
  "id"           SERIAL PRIMARY KEY,
  "local_id"     INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "cliente_id"   INTEGER NOT NULL REFERENCES "cliente"("id") ON DELETE CASCADE,
  "hasta"        TIMESTAMP(3) NOT NULL,
  "motivo"       TEXT NOT NULL,
  "liberado_por" INTEGER,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "bloqueo_cliente_cliente_hasta_idx" ON "bloqueo_cliente" ("cliente_id", "hasta");

-- Cita: deja de guardar nombre/teléfono en claro (D6). Los datos van a `cliente` (cifrado + hash).
ALTER TABLE "cita" ADD COLUMN "slot_id" INTEGER REFERENCES "slot"("id");
ALTER TABLE "cita" ADD COLUMN "cliente_id" INTEGER REFERENCES "cliente"("id");
ALTER TABLE "cita" ADD COLUMN "fecha" DATE;
ALTER TABLE "cita" ADD COLUMN "canal" "CanalCita" NOT NULL DEFAULT 'WEB';
ALTER TABLE "cita" ADD COLUMN "codigo_checkin" VARCHAR(6);
ALTER TABLE "cita" ADD COLUMN "tarde" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "cita" ADD COLUMN "confirmada_at" TIMESTAMP(3);
ALTER TABLE "cita" ADD COLUMN "checkin_at" TIMESTAMP(3);
ALTER TABLE "cita" ADD COLUMN "cancelada_at" TIMESTAMP(3);
ALTER TABLE "cita" ADD COLUMN "motivo_cancelacion" TEXT;

-- Migración de citas previas (si las hubiera): slot materializado y cliente sin teléfono en claro
INSERT INTO "slot" ("cola_id", "inicio", "fin", "capacidad", "reservados")
SELECT c.cola_id, c.inicio, MAX(c.fin), GREATEST(3, COUNT(*) FILTER (WHERE c.estado IN ('RESERVADA', 'CONFIRMADA'))),
       COUNT(*) FILTER (WHERE c.estado IN ('RESERVADA', 'CONFIRMADA'))
  FROM "cita" c GROUP BY c.cola_id, c.inicio
ON CONFLICT DO NOTHING;
UPDATE "cita" c SET "slot_id" = s.id FROM "slot" s WHERE s.cola_id = c.cola_id AND s.inicio = c.inicio;
UPDATE "cita" SET "fecha" = ("inicio" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Lima')::date WHERE "fecha" IS NULL;
UPDATE "cita" SET "codigo_checkin" = upper(substr(md5(token || id::text), 1, 6)) WHERE "codigo_checkin" IS NULL;
DO $$
DECLARE r RECORD; v_cliente INT;
BEGIN
  FOR r IN SELECT id, nombre FROM cita WHERE cliente_id IS NULL LOOP
    INSERT INTO cliente (nombre) VALUES (r.nombre) RETURNING id INTO v_cliente;
    UPDATE cita SET cliente_id = v_cliente WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "cita" DROP COLUMN "nombre";
ALTER TABLE "cita" DROP COLUMN "telefono";
ALTER TABLE "cita" ALTER COLUMN "slot_id" SET NOT NULL;
ALTER TABLE "cita" ALTER COLUMN "cliente_id" SET NOT NULL;
ALTER TABLE "cita" ALTER COLUMN "fecha" SET NOT NULL;
ALTER TABLE "cita" ALTER COLUMN "codigo_checkin" SET NOT NULL;
ALTER TABLE "cita" RENAME COLUMN "created_at" TO "creada_at";
CREATE UNIQUE INDEX "cita_codigo_checkin_key" ON "cita" ("codigo_checkin");
CREATE INDEX "cita_local_fecha_estado_idx" ON "cita" ("local_id", "fecha", "estado");
CREATE INDEX "cita_slot_idx" ON "cita" ("slot_id");
-- RN-M3-01: 1 cita activa por cliente, cola y día
CREATE UNIQUE INDEX "ux_cita_activa" ON "cita" ("cliente_id", "cola_id", "fecha") WHERE estado IN ('RESERVADA', 'CONFIRMADA');

CREATE TABLE "cita_evento" (
  "id"         BIGSERIAL PRIMARY KEY,
  "cita_id"    INTEGER NOT NULL REFERENCES "cita"("id") ON DELETE CASCADE,
  "tipo"       TEXT NOT NULL,
  "datos"      JSONB,
  "actor"      TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "cita_evento_cita_idx" ON "cita_evento" ("cita_id");

-- RN-M3-08: un recordatorio por cita y tipo (cierra D4 para citas)
CREATE TABLE "cita_recordatorio" (
  "cita_id"    INTEGER NOT NULL REFERENCES "cita"("id") ON DELETE CASCADE,
  "tipo"       TEXT NOT NULL,
  "enviado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("cita_id", "tipo")
);

ALTER TABLE "turno" ADD CONSTRAINT "turno_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "cita"("id");

-- Configuración de citas por cola (apagada hasta que el admin la active)
INSERT INTO "config_citas" ("cola_id") SELECT id FROM "cola" ON CONFLICT DO NOTHING;

