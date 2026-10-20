-- ---------------------------------------------------------------------------
-- Ajustes encontrados por las pruebas de concurrencia (tests/integracion).
-- ---------------------------------------------------------------------------

-- 1) Un celular = un cliente. Sin esto, dos reservas simultáneas del mismo celular creaban dos clientes
--    y esquivaban RN03 / RN-M3-01. Se unifican duplicados previos (si los hubiera) antes del índice.
WITH dup AS (
  SELECT id, MIN(id) OVER (PARTITION BY telefono_hash) AS principal
    FROM cliente WHERE telefono_hash IS NOT NULL
)
UPDATE turno t SET cliente_id = d.principal FROM dup d WHERE t.cliente_id = d.id AND d.id <> d.principal;
WITH dup AS (
  SELECT id, MIN(id) OVER (PARTITION BY telefono_hash) AS principal
    FROM cliente WHERE telefono_hash IS NOT NULL
)
UPDATE cita c SET cliente_id = d.principal FROM dup d WHERE c.cliente_id = d.id AND d.id <> d.principal;
WITH dup AS (
  SELECT id, MIN(id) OVER (PARTITION BY telefono_hash) AS principal
    FROM cliente WHERE telefono_hash IS NOT NULL
)
UPDATE bloqueo_cliente b SET cliente_id = d.principal FROM dup d WHERE b.cliente_id = d.id AND d.id <> d.principal;
DELETE FROM cliente c USING cliente o
 WHERE c.telefono_hash IS NOT NULL AND c.telefono_hash = o.telefono_hash AND c.id > o.id;
CREATE UNIQUE INDEX "ux_cliente_telefono_hash" ON "cliente" ("telefono_hash") WHERE telefono_hash IS NOT NULL;

-- 2) siguiente_turno con reintento: con FOR UPDATE SKIP LOCKED + LIMIT 1 se devuelven 0 filas si el candidato
--    está bloqueado un instante (p. ej. revisarAvisos lo pasa a AVISADO) o cambió durante la re-verificación.
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
  v_intento INT := 0;
BEGIN
  SELECT COALESCE(tope_adelantos, 0) INTO v_tope FROM config_prioridad WHERE local_id = p_local;
  v_tope := COALESCE(v_tope, 0);

  LOOP
    v_id := NULL;
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
    EXIT WHEN v_id IS NOT NULL;
    v_intento := v_intento + 1;
    -- Solo se reintenta si aún hay turnos en espera (pueden estar bloqueados un instante por el aviso automático)
    EXIT WHEN v_intento >= 10 OR NOT EXISTS (
      SELECT 1 FROM turno t
       WHERE t.local_id = p_local AND t.fecha = p_fecha AND t.estado IN ('EMITIDO', 'AVISADO')
         AND (p_cola IS NULL OR t.cola_id = p_cola));
    PERFORM pg_sleep(0.02);
  END LOOP;

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
    NULL;
  ELSIF v_peso > 0 THEN
    UPDATE estado_prioridad_cola SET preferentes_consecutivos = preferentes_consecutivos + 1
     WHERE cola_id = v_cola AND fecha = p_fecha;
  ELSE
    UPDATE estado_prioridad_cola SET preferentes_consecutivos = 0
     WHERE cola_id = v_cola AND fecha = p_fecha;
  END IF;

  RETURN v_id;
END $$;
