-- Módulos de operación: prioridades, horario, citas, valoración.
-- Los valores de enum nuevos no se insertan en esta misma migración.

ALTER TYPE "EstadoTurno" ADD VALUE IF NOT EXISTS 'TRANSFERIDO';
ALTER TYPE "CanalTurno" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "CanalTurno" ADD VALUE IF NOT EXISTS 'KIOSCO';
ALTER TYPE "CanalTurno" ADD VALUE IF NOT EXISTS 'CITA';

CREATE TYPE "DocumentoPrioridad" AS ENUM ('NINGUNO', 'DNI', 'CARNE_GESTANTE', 'CONADIS', 'TRIAJE');
CREATE TYPE "EstadoCita" AS ENUM ('RESERVADA', 'CONFIRMADA', 'CHECKIN', 'CANCELADA', 'NO_SHOW');

ALTER TABLE "local" ADD COLUMN "tiempo_ausencia_seg" INTEGER DEFAULT 180;

ALTER TABLE "turno" ADD COLUMN "categoria_id" INTEGER;
ALTER TABLE "turno" ADD COLUMN "clave_orden" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "turno" ADD COLUMN "prioridad_verificada" BOOLEAN;

CREATE TABLE "categoria_prioridad" (
  "id" SERIAL PRIMARY KEY,
  "local_id" INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "codigo" VARCHAR(16) NOT NULL,
  "nombre" TEXT NOT NULL,
  "peso_base" INTEGER NOT NULL DEFAULT 0,
  "absoluta" BOOLEAN NOT NULL DEFAULT false,
  "documento" "DocumentoPrioridad" NOT NULL DEFAULT 'NINGUNO',
  "visible_cliente" BOOLEAN NOT NULL DEFAULT true,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "orden" INTEGER NOT NULL DEFAULT 0,
  UNIQUE ("local_id", "codigo")
);

CREATE TABLE "config_prioridad" (
  "local_id" INTEGER PRIMARY KEY REFERENCES "local"("id") ON DELETE CASCADE,
  "alfa_puntos_por_min" DECIMAL(6,3) NOT NULL DEFAULT 1.5,
  "tope_adelantos" INTEGER NOT NULL DEFAULT 3,
  "aging_activo" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "estado_prioridad_cola" (
  "cola_id" INTEGER NOT NULL,
  "fecha" DATE NOT NULL,
  "preferentes_consecutivos" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("cola_id", "fecha")
);

CREATE TABLE "horario_local" (
  "id" SERIAL PRIMARY KEY,
  "local_id" INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "dia_semana" INTEGER NOT NULL,
  "apertura" TEXT NOT NULL,
  "cierre" TEXT NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  UNIQUE ("local_id", "dia_semana")
);

CREATE TABLE "valoracion" (
  "id" SERIAL PRIMARY KEY,
  "turno_id" INTEGER NOT NULL UNIQUE REFERENCES "turno"("id") ON DELETE CASCADE,
  "estrellas" INTEGER NOT NULL,
  "comentario" VARCHAR(280),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "cita" (
  "id" SERIAL PRIMARY KEY,
  "local_id" INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "cola_id" INTEGER NOT NULL,
  "inicio" TIMESTAMP(3) NOT NULL,
  "fin" TIMESTAMP(3) NOT NULL,
  "nombre" TEXT NOT NULL,
  "telefono" TEXT,
  "estado" "EstadoCita" NOT NULL DEFAULT 'RESERVADA',
  "token" VARCHAR(16) NOT NULL UNIQUE,
  "turno_id" INTEGER UNIQUE REFERENCES "turno"("id"),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ix_turno_espera" ON "turno" ("cola_id", "clave_orden" DESC, "emitido_at" ASC, "id" ASC);
CREATE INDEX "cita_local_inicio" ON "cita" ("local_id", "inicio");

ALTER TABLE "turno" ADD CONSTRAINT "turno_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria_prioridad"("id");

INSERT INTO "categoria_prioridad" ("local_id", "codigo", "nombre", "peso_base", "absoluta", "documento", "visible_cliente", "orden")
SELECT l.id, c.codigo, c.nombre, c.peso, c.absoluta, c.documento::"DocumentoPrioridad", c.visible, c.orden
FROM "local" l
CROSS JOIN (VALUES
  ('GENERAL', 'General', 0, false, 'NINGUNO', true, 0),
  ('ADULTO_MAYOR', 'Adulto mayor (60+)', 60, false, 'DNI', true, 1),
  ('GESTANTE', 'Gestante', 60, false, 'CARNE_GESTANTE', true, 2),
  ('DISCAPACIDAD', 'Persona con discapacidad', 50, false, 'CONADIS', true, 3),
  ('EMERGENCIA', 'Emergencia', 100, true, 'TRIAJE', false, 4),
  ('CITA', 'Cita reservada', 80, false, 'NINGUNO', false, 5)
) AS c(codigo, nombre, peso, absoluta, documento, visible, orden)
WHERE l.activo = true
ON CONFLICT DO NOTHING;

INSERT INTO "config_prioridad" ("local_id")
SELECT id FROM "local" WHERE activo = true
ON CONFLICT DO NOTHING;

INSERT INTO "horario_local" ("local_id", "dia_semana", "apertura", "cierre")
SELECT l.id, d.dia, '08:00', '20:00'
FROM "local" l
CROSS JOIN (VALUES (1),(2),(3),(4),(5),(6)) AS d(dia)
WHERE l.activo = true
ON CONFLICT DO NOTHING;
