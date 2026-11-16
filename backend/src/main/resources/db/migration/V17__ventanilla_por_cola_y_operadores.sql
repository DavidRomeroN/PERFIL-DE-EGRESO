-- Modelo simplificado: cada cola tiene una sola ventanilla y cada ventanilla atiende una sola cola.
-- Lo que varía es el operador: uno solo puede llamar en varias ventanillas o cada operador en la suya.

-- 1) Ventanillas activas sin cola ("todas las colas") ya no existen: se desactivan.
UPDATE "ventanilla" SET "activa" = false
 WHERE "activa" AND "cola_id" IS NULL AND "cola_original_id" IS NULL;

-- 2) Si una cola tenía varias ventanillas activas, se conserva la más antigua y las demás se desactivan.
UPDATE "ventanilla" v SET "activa" = false
  FROM (SELECT "id", row_number() OVER (PARTITION BY COALESCE("cola_original_id", "cola_id") ORDER BY "id") AS n
          FROM "ventanilla" WHERE "activa") d
 WHERE v."id" = d."id" AND d.n > 1;

-- 3) Cada cola activa sin ventanilla recibe una con su mismo nombre.
INSERT INTO "ventanilla" ("local_id", "nombre", "cola_id")
SELECT c."local_id", left(c."nombre", 40), c."id"
  FROM "cola" c
 WHERE c."activa"
   AND NOT EXISTS (SELECT 1 FROM "ventanilla" v WHERE v."activa" AND COALESCE(v."cola_original_id", v."cola_id") = c."id");

-- 4) Ventanillas que puede usar cada operador (un operador puede tener una, varias o todas).
CREATE TABLE "usuario_ventanilla" (
    "usuario_id"    INTEGER NOT NULL REFERENCES "usuario"("id") ON DELETE CASCADE,
    "ventanilla_id" INTEGER NOT NULL REFERENCES "ventanilla"("id") ON DELETE CASCADE,
    PRIMARY KEY ("usuario_id", "ventanilla_id")
);
CREATE INDEX "usuario_ventanilla_ventanilla_idx" ON "usuario_ventanilla" ("ventanilla_id");

-- Los operadores que ya existían conservan lo que podían hacer: todas las ventanillas activas de su local.
INSERT INTO "usuario_ventanilla" ("usuario_id", "ventanilla_id")
SELECT u."id", v."id"
  FROM "usuario" u JOIN "ventanilla" v ON v."local_id" = u."local_id" AND v."activa"
 WHERE u."rol" = 'OPERADOR';
