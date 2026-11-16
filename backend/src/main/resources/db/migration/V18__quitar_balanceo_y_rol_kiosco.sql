-- 1) Se retira el balanceo automático por reglas. Las transferencias (M6) se quedan.
--    Si una regla había movido una ventanilla a otra cola, vuelve a la suya.
UPDATE "ventanilla" SET "cola_id" = "cola_original_id" WHERE "cola_original_id" IS NOT NULL;
ALTER TABLE "ventanilla" DROP COLUMN IF EXISTS "cola_original_id";
ALTER TABLE "ventanilla" DROP COLUMN IF EXISTS "asignacion_temporal_hasta";
ALTER TABLE "ventanilla" DROP COLUMN IF EXISTS "regla_asignadora_id";

DROP TABLE IF EXISTS "ejecucion_regla";
DROP TABLE IF EXISTS "regla_estado";
DROP TABLE IF EXISTS "regla_balanceo";
DELETE FROM "job_estado" WHERE "nombre" IN ('balanceo-evaluar', 'balanceo-limpiar');

-- 2) Nuevo rol: kiosco. Solo ve las colas, emite tickets para cualquiera y transfiere clientes; no llama.
ALTER TYPE "RolUsuario" ADD VALUE IF NOT EXISTS 'KIOSCO';
