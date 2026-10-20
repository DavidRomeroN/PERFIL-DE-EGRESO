-- ---------------------------------------------------------------------------
-- TurnoYa — Programación en base de datos (sección 9.3)
--   * emitir_turno(): número correlativo sin duplicados bajo concurrencia
--   * tiempo_estimado(): regla RN02 (posición × promedio móvil de los últimos 10)
--   * v_espera_diaria: tiempos promedio por cola y hora
--   * trigger de auditoría sobre turno y usuario
-- ---------------------------------------------------------------------------

-- Emisión de turno con numeración diaria por cola (RN01).
-- El UPSERT sobre contador_cola toma un bloqueo de fila, por lo que dos
-- emisiones simultáneas jamás obtienen el mismo número.
CREATE OR REPLACE FUNCTION emitir_turno(
  p_cola    INT,
  p_cliente INT,
  p_canal   TEXT,
  p_token   TEXT,
  p_fecha   DATE
) RETURNS turno LANGUAGE plpgsql AS $$
DECLARE
  v_num   INT;
  v_pref  TEXT;
  v_local INT;
  r       turno;
BEGIN
  SELECT prefijo, local_id INTO v_pref, v_local
    FROM cola WHERE id = p_cola AND activa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLA_INACTIVA' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO contador_cola (cola_id, fecha, ultimo_numero)
  VALUES (p_cola, p_fecha, 1)
  ON CONFLICT (cola_id, fecha)
    DO UPDATE SET ultimo_numero = contador_cola.ultimo_numero + 1
  RETURNING ultimo_numero INTO v_num;

  INSERT INTO turno (local_id, cola_id, fecha, numero, codigo, token, cliente_id, canal, estado, rellamadas, emitido_at)
  VALUES (
    v_local, p_cola, p_fecha, v_num,
    v_pref || '-' || lpad(v_num::text, 3, '0'),
    p_token, p_cliente, p_canal::"CanalTurno", 'EMITIDO', 0, now()
  )
  RETURNING * INTO r;

  RETURN r;
END $$;

-- RN02: tiempo estimado (segundos) = posición × promedio móvil de los últimos
-- 10 tiempos de atención (llamado → finalizado) de la cola.
CREATE OR REPLACE FUNCTION tiempo_estimado(p_cola INT, p_posicion INT)
RETURNS INT LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_prom NUMERIC;
  v_base INT;
BEGIN
  SELECT tiempo_atencion_base INTO v_base FROM cola WHERE id = p_cola;

  SELECT AVG(EXTRACT(EPOCH FROM (t.finalizado_at - t.llamado_at)))
    INTO v_prom
    FROM (
      SELECT llamado_at, finalizado_at
        FROM turno
       WHERE cola_id = p_cola
         AND estado = 'ATENDIDO'
         AND llamado_at IS NOT NULL
         AND finalizado_at IS NOT NULL
       ORDER BY finalizado_at DESC
       LIMIT 10
    ) t;

  IF v_prom IS NULL OR v_prom < 30 THEN
    v_prom := COALESCE(v_base, 300);
  END IF;

  RETURN GREATEST(0, p_posicion) * ROUND(v_prom)::INT;
END $$;

-- Vista de espera diaria por cola y hora.
CREATE OR REPLACE VIEW v_espera_diaria AS
SELECT
  t.local_id,
  t.cola_id,
  c.nombre                                   AS cola,
  t.fecha,
  EXTRACT(HOUR FROM t.emitido_at)::INT       AS hora,
  COUNT(*)                                   AS turnos,
  COUNT(*) FILTER (WHERE t.estado = 'ATENDIDO')       AS atendidos,
  COUNT(*) FILTER (WHERE t.estado = 'NO_SE_PRESENTO') AS no_presentados,
  COUNT(*) FILTER (WHERE t.estado = 'CANCELADO')      AS cancelados,
  ROUND(AVG(EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)) / 60)
        FILTER (WHERE t.llamado_at IS NOT NULL), 1)   AS espera_prom_min,
  ROUND(AVG(EXTRACT(EPOCH FROM (t.finalizado_at - t.llamado_at)) / 60)
        FILTER (WHERE t.estado = 'ATENDIDO' AND t.finalizado_at IS NOT NULL), 1) AS atencion_prom_min
FROM turno t
JOIN cola c ON c.id = t.cola_id
GROUP BY t.local_id, t.cola_id, c.nombre, t.fecha, EXTRACT(HOUR FROM t.emitido_at);

-- Trigger de auditoría (turno y usuario)
CREATE OR REPLACE FUNCTION fn_auditoria() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_local INT;
  v_id    TEXT;
  v_datos JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_datos := to_jsonb(OLD);
  ELSE
    v_datos := to_jsonb(NEW);
  END IF;
  v_local := (v_datos ->> 'local_id')::INT;
  v_id    := v_datos ->> 'id';
  INSERT INTO auditoria (local_id, usuario_id, accion, entidad, entidad_id, datos_json, created_at)
  VALUES (v_local, NULL, TG_OP, TG_TABLE_NAME, v_id,
          CASE WHEN TG_TABLE_NAME = 'usuario' THEN v_datos - 'hash_password' ELSE v_datos END,
          now());
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_auditoria_turno ON turno;
CREATE TRIGGER trg_auditoria_turno
  AFTER INSERT OR UPDATE OR DELETE ON turno
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria_usuario ON usuario;
CREATE TRIGGER trg_auditoria_usuario
  AFTER INSERT OR UPDATE OR DELETE ON usuario
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

-- Índice parcial: un cliente solo puede tener 1 turno activo por cola (RN03)
CREATE UNIQUE INDEX IF NOT EXISTS ux_turno_activo_cliente
  ON turno (cola_id, cliente_id)
  WHERE estado IN ('EMITIDO', 'AVISADO', 'LLAMADO') AND cliente_id IS NOT NULL;
