-- ---------------------------------------------------------------------------
-- Fundaciones (docs/PLAN_INTEGRAL.md §4): F1 jobs, F3 banderas, F4 auditoría
-- con actor, F5 emitir_turno/siguiente_turno/posicion_turno, idempotencia y
-- límite de peticiones persistente. Todo aditivo salvo `job_interno` (D8),
-- que era una tabla de bitácora que crecía cada 30 s y nadie leía.
-- ---------------------------------------------------------------------------

-- F3 · Banderas de módulo por plan y por local --------------------------------
CREATE TYPE "ModuloCodigo" AS ENUM ('M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8');

CREATE TABLE "plan_modulo" (
  "plan_id" INTEGER NOT NULL REFERENCES "plan"("id") ON DELETE CASCADE,
  "modulo"  "ModuloCodigo" NOT NULL,
  PRIMARY KEY ("plan_id", "modulo")
);

CREATE TABLE "local_modulo" (
  "local_id"      INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "modulo"        "ModuloCodigo" NOT NULL,
  "habilitado"    BOOLEAN NOT NULL DEFAULT false,
  "config"        JSONB,
  "actualizado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("local_id", "modulo")
);

-- Matriz §7 del plan
INSERT INTO "plan_modulo" ("plan_id", "modulo")
SELECT p.id, m.modulo::"ModuloCodigo"
  FROM "plan" p
  JOIN (VALUES
    ('EMPRENDE', 'M1'), ('EMPRENDE', 'M3'), ('EMPRENDE', 'M4'), ('EMPRENDE', 'M6'),
    ('PRO', 'M1'), ('PRO', 'M2'), ('PRO', 'M3'), ('PRO', 'M4'),
    ('PRO', 'M5'), ('PRO', 'M6'), ('PRO', 'M7'), ('PRO', 'M8')
  ) AS m(plan, modulo) ON m.plan = p.codigo
ON CONFLICT DO NOTHING;

-- Los locales existentes conservan lo que ya tenían por su plan (antes se activaba solo por plan).
INSERT INTO "local_modulo" ("local_id", "modulo", "habilitado")
SELECT l.id, pm.modulo, true
  FROM "local" l JOIN "plan_modulo" pm ON pm.plan_id = l.plan_id
ON CONFLICT DO NOTHING;

-- F1 · Estado de los jobs programados ----------------------------------------
DROP TABLE IF EXISTS "job_interno";

CREATE TABLE "job_estado" (
  "nombre"           TEXT PRIMARY KEY,
  "ultima_corrida"   TIMESTAMP(3),
  "ultima_duracion_ms" INTEGER,
  "ultimo_resultado" JSONB,
  "ultimo_error"     TEXT,
  "corridas"         INTEGER NOT NULL DEFAULT 0,
  "fallos"           INTEGER NOT NULL DEFAULT 0,
  "proxima"          TIMESTAMP(3)
);

-- F4 · Auditoría con actor -----------------------------------------------------
ALTER TABLE "auditoria" ADD COLUMN "ip" TEXT;
ALTER TABLE "auditoria" ADD COLUMN "request_id" TEXT;
ALTER TABLE "auditoria" ADD COLUMN "accion_humana" TEXT;
CREATE INDEX "auditoria_request_id_idx" ON "auditoria" ("request_id");

CREATE OR REPLACE FUNCTION fn_auditoria() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_local   INT;
  v_id      TEXT;
  v_datos   JSONB;
  v_usuario INT := NULLIF(current_setting('app.usuario_id', true), '')::INT;
  v_ip      TEXT := NULLIF(current_setting('app.ip', true), '');
  v_req     TEXT := NULLIF(current_setting('app.request_id', true), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_datos := to_jsonb(OLD);
  ELSE
    v_datos := to_jsonb(NEW);
  END IF;
  v_local := COALESCE((v_datos ->> 'local_id')::INT, CASE WHEN TG_TABLE_NAME = 'local' THEN (v_datos ->> 'id')::INT END);
  v_id    := v_datos ->> 'id';
  IF TG_OP = 'UPDATE' THEN
    -- Solo lo que cambió (antes/después) para que el detalle sea legible
    SELECT jsonb_object_agg(n.key, jsonb_build_object('antes', o.value, 'despues', n.value))
      INTO v_datos
      FROM jsonb_each(to_jsonb(NEW)) n
      JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
     WHERE n.value IS DISTINCT FROM o.value;
    IF v_datos IS NULL THEN RETURN NULL; END IF;
    v_datos := v_datos || jsonb_build_object('id', v_id);
  END IF;
  INSERT INTO auditoria (local_id, usuario_id, accion, entidad, entidad_id, datos_json, ip, request_id, created_at)
  VALUES (v_local, v_usuario, TG_OP, TG_TABLE_NAME, v_id,
          CASE WHEN TG_TABLE_NAME = 'usuario' THEN v_datos - 'hash_password' ELSE v_datos END,
          v_ip, v_req, now());
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_auditoria_cola ON cola;
CREATE TRIGGER trg_auditoria_cola AFTER INSERT OR UPDATE OR DELETE ON cola
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria();
DROP TRIGGER IF EXISTS trg_auditoria_ventanilla ON ventanilla;
CREATE TRIGGER trg_auditoria_ventanilla AFTER INSERT OR UPDATE OR DELETE ON ventanilla
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria();
DROP TRIGGER IF EXISTS trg_auditoria_categoria ON categoria_prioridad;
CREATE TRIGGER trg_auditoria_categoria AFTER INSERT OR UPDATE OR DELETE ON categoria_prioridad
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria();
DROP TRIGGER IF EXISTS trg_auditoria_local_modulo ON local_modulo;
CREATE TRIGGER trg_auditoria_local_modulo AFTER INSERT OR UPDATE OR DELETE ON local_modulo
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

-- F5 · Columnas nuevas de turno ------------------------------------------------
ALTER TABLE "turno" ADD COLUMN "cita_id" INTEGER;
ALTER TABLE "turno" ADD COLUMN "origen_dispositivo_id" INTEGER;
ALTER TABLE "turno" ADD COLUMN "codigo_provisional" VARCHAR(16);
ALTER TABLE "turno" ADD COLUMN "transferido_de_turno_id" INTEGER REFERENCES "turno"("id");
ALTER TABLE "turno" ADD COLUMN "sucesor_id" INTEGER REFERENCES "turno"("id");
ALTER TABLE "turno" ADD COLUMN "delante_emision" INTEGER;
ALTER TABLE "turno" ADD COLUMN "ventanillas_activas_emision" INTEGER;
ALTER TABLE "turno" ADD COLUMN "aviso_min_antes" INTEGER;
ALTER TABLE "turno" ADD COLUMN "aviso_min_enviado_at" TIMESTAMP(3);

-- Índice parcial: solo los turnos en espera (sirve a siguiente_turno y posicion_turno)
DROP INDEX IF EXISTS "ix_turno_espera";
CREATE INDEX "ix_turno_espera" ON "turno" ("cola_id", "clave_orden" DESC, "emitido_at" ASC, "id" ASC)
  WHERE estado IN ('EMITIDO', 'AVISADO');

-- Clave de orden (M1 §5.2). Se elimina la versión de 3 argumentos que nunca se usó (D16).
DROP FUNCTION IF EXISTS calcular_clave_orden(double precision, timestamptz, double precision);
CREATE OR REPLACE FUNCTION calcular_clave_orden(
  p_peso numeric, p_emitido timestamptz, p_alfa numeric, p_aging boolean
) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_peso - CASE WHEN p_aging
            THEN p_alfa * EXTRACT(EPOCH FROM (p_emitido - TIMESTAMPTZ '2026-01-01 00:00:00+00')) / 60.0
            ELSE 0 END)::double precision
$$;

-- Peso efectivo de una categoría (absoluta = 1 000 000; sin categoría = 0)
CREATE OR REPLACE FUNCTION peso_categoria(p_categoria INT) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT CASE WHEN c.absoluta THEN 1000000 ELSE c.peso_base END
                     FROM categoria_prioridad c WHERE c.id = p_categoria), 0)::numeric
$$;

-- Emisión extendida (F5). La firma antigua de 5 argumentos se conserva y delega.
CREATE OR REPLACE FUNCTION emitir_turno(
  p_cola      INT,
  p_cliente   INT,
  p_canal     TEXT,
  p_token     TEXT,
  p_fecha     DATE,
  p_categoria INT,
  p_emitido   TIMESTAMP,
  p_origen    JSONB
) RETURNS turno LANGUAGE plpgsql AS $$
DECLARE
  v_num     INT;
  v_pref    TEXT;
  v_local   INT;
  v_alfa    NUMERIC := 0;
  v_aging   BOOLEAN := false;
  v_emitido TIMESTAMP := COALESCE(p_emitido, now()::timestamp);
  v_delante INT;
  v_vent    INT;
  r         turno;
BEGIN
  SELECT prefijo, local_id INTO v_pref, v_local
    FROM cola WHERE id = p_cola AND activa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLA_INACTIVA' USING ERRCODE = 'P0001';
  END IF;

  -- Sin categoría el peso es 0 y la clave = −α·minutos: el orden es FIFO, igual que antes de M1
  SELECT alfa_puntos_por_min, aging_activo INTO v_alfa, v_aging
    FROM config_prioridad WHERE local_id = v_local;
  v_alfa := COALESCE(v_alfa, 0);
  v_aging := COALESCE(v_aging, false);

  INSERT INTO contador_cola (cola_id, fecha, ultimo_numero)
  VALUES (p_cola, p_fecha, 1)
  ON CONFLICT (cola_id, fecha)
    DO UPDATE SET ultimo_numero = contador_cola.ultimo_numero + 1
  RETURNING ultimo_numero INTO v_num;

  -- Contexto de emisión para M2 (cuántos había delante y cuántas ventanillas atendían)
  SELECT COUNT(*) INTO v_delante FROM turno
   WHERE cola_id = p_cola AND fecha = p_fecha AND estado IN ('EMITIDO', 'AVISADO');
  SELECT COUNT(*) INTO v_vent FROM ventanilla
   WHERE local_id = v_local AND activa AND (cola_id = p_cola OR cola_id IS NULL);

  INSERT INTO turno (local_id, cola_id, fecha, numero, codigo, token, cliente_id, canal, estado, rellamadas,
                     emitido_at, categoria_id, clave_orden, cita_id, origen_dispositivo_id, codigo_provisional,
                     transferido_de_turno_id, delante_emision, ventanillas_activas_emision)
  VALUES (
    v_local, p_cola, p_fecha, v_num,
    v_pref || '-' || lpad(v_num::text, 3, '0'),
    p_token, p_cliente, p_canal::"CanalTurno", 'EMITIDO', 0,
    v_emitido, p_categoria,
    calcular_clave_orden(peso_categoria(p_categoria), v_emitido AT TIME ZONE 'UTC', v_alfa, v_aging),
    (p_origen ->> 'cita_id')::INT,
    (p_origen ->> 'dispositivo_id')::INT,
    p_origen ->> 'codigo_provisional',
    (p_origen ->> 'transferido_de')::INT,
    v_delante, v_vent
  )
  RETURNING * INTO r;

  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION emitir_turno(
  p_cola INT, p_cliente INT, p_canal TEXT, p_token TEXT, p_fecha DATE
) RETURNS turno LANGUAGE sql AS $$
  SELECT * FROM emitir_turno(p_cola, p_cliente, p_canal, p_token, p_fecha, NULL::INT, NULL::TIMESTAMP, NULL::JSONB)
$$;

-- Posición exacta = 1 + turnos que van antes (M1 §5.2)
CREATE OR REPLACE FUNCTION posicion_turno(p_turno INT) RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT 1 + COUNT(*)::INT
    FROM turno t
    JOIN turno o ON o.cola_id = t.cola_id AND o.fecha = t.fecha
   WHERE t.id = p_turno
     AND o.id <> t.id
     AND o.estado IN ('EMITIDO', 'AVISADO')
     AND (o.clave_orden > t.clave_orden
          OR (o.clave_orden = t.clave_orden AND (o.emitido_at < t.emitido_at
              OR (o.emitido_at = t.emitido_at AND o.id < t.id))))
$$;

-- Selección atómica del siguiente turno (M1 §6.2, ADR-05).
-- Debe llamarse dentro de la misma transacción que marca el turno como LLAMADO.
--   * FOR UPDATE SKIP LOCKED: dos ventanillas nunca toman el mismo turno (C2)
--   * estado_prioridad_cola FOR UPDATE: la racha de preferentes es coherente (C15)
CREATE OR REPLACE FUNCTION siguiente_turno(p_local INT, p_cola INT, p_fecha DATE)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_tope   INT := 0;
  v_racha  INT;
  v_id     INT;
  v_cola   INT;
  v_peso   INT;
  v_abs    BOOLEAN;
  v_gen    INT;
BEGIN
  SELECT COALESCE(tope_adelantos, 0) INTO v_tope FROM config_prioridad WHERE local_id = p_local;
  v_tope := COALESCE(v_tope, 0);

  SELECT t.id, t.cola_id, COALESCE(c.peso_base, 0), COALESCE(c.absoluta, false)
    INTO v_id, v_cola, v_peso, v_abs
    FROM turno t
    LEFT JOIN categoria_prioridad c ON c.id = t.categoria_id
   WHERE t.local_id = p_local AND t.fecha = p_fecha
     AND t.estado IN ('EMITIDO', 'AVISADO')
     AND (p_cola IS NULL OR t.cola_id = p_cola)
   ORDER BY t.clave_orden DESC, t.emitido_at ASC, t.id ASC
   FOR UPDATE OF t SKIP LOCKED
   LIMIT 1;

  IF v_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO estado_prioridad_cola (cola_id, fecha, preferentes_consecutivos)
  VALUES (v_cola, p_fecha, 0)
  ON CONFLICT (cola_id, fecha) DO NOTHING;
  SELECT preferentes_consecutivos INTO v_racha
    FROM estado_prioridad_cola WHERE cola_id = v_cola AND fecha = p_fecha FOR UPDATE;

  IF v_tope > 0 AND v_peso > 0 AND NOT v_abs AND v_racha >= v_tope THEN
    SELECT t.id INTO v_gen
      FROM turno t
      LEFT JOIN categoria_prioridad c ON c.id = t.categoria_id
     WHERE t.local_id = p_local AND t.fecha = p_fecha AND t.cola_id = v_cola
       AND t.estado IN ('EMITIDO', 'AVISADO')
       AND COALESCE(c.peso_base, 0) = 0 AND NOT COALESCE(c.absoluta, false)
     ORDER BY t.clave_orden DESC, t.emitido_at ASC, t.id ASC
     FOR UPDATE OF t SKIP LOCKED
     LIMIT 1;
    IF v_gen IS NOT NULL THEN
      v_id := v_gen; v_peso := 0; v_abs := false;
    END IF;
  END IF;

  IF v_abs THEN
    NULL; -- RN-M1-02: la emergencia no altera la racha
  ELSIF v_peso > 0 THEN
    UPDATE estado_prioridad_cola SET preferentes_consecutivos = preferentes_consecutivos + 1
     WHERE cola_id = v_cola AND fecha = p_fecha;
  ELSE
    UPDATE estado_prioridad_cola SET preferentes_consecutivos = 0
     WHERE cola_id = v_cola AND fecha = p_fecha;
  END IF;

  RETURN v_id;
END $$;

-- Recalculo masivo en una sola sentencia (C4 / RN-M1-05)
CREATE OR REPLACE FUNCTION recalcular_claves(p_local INT, p_fecha DATE) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_alfa  NUMERIC := 0;
  v_aging BOOLEAN := false;
  v_n     INT;
BEGIN
  SELECT alfa_puntos_por_min, aging_activo INTO v_alfa, v_aging FROM config_prioridad WHERE local_id = p_local;
  UPDATE turno t
     SET clave_orden = calcular_clave_orden(peso_categoria(t.categoria_id), t.emitido_at AT TIME ZONE 'UTC',
                                            COALESCE(v_alfa, 0), COALESCE(v_aging, false))
   WHERE t.local_id = p_local AND t.fecha >= p_fecha AND t.estado IN ('EMITIDO', 'AVISADO');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ADR-04 · Idempotencia -------------------------------------------------------
CREATE TABLE "idempotencia" (
  "clave"     TEXT NOT NULL,
  "ruta"      TEXT NOT NULL,
  "status"    INTEGER NOT NULL,
  "respuesta" JSONB NOT NULL,
  "creada_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expira_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("ruta", "clave")
);
CREATE INDEX "idempotencia_expira_idx" ON "idempotencia" ("expira_at");

-- F7 · Límite de peticiones persistente (sobrevive a reinicios y sirve con varias instancias)
CREATE TABLE "rate_limit" (
  "clave"    TEXT NOT NULL,
  "ventana"  TIMESTAMP(3) NOT NULL,
  "contador" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("clave", "ventana")
);
CREATE INDEX "rate_limit_ventana_idx" ON "rate_limit" ("ventana");
