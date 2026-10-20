-- Borrar un local fallaba: los triggers de auditoría de las filas borradas en cascada
-- insertaban auditoria.local_id apuntando al local que se estaba eliminando.
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
  -- Al borrar un local, la cascada borra sus colas/categorías: el local ya no existe y la fila de auditoría queda sin local
  IF v_local IS NOT NULL AND NOT EXISTS (SELECT 1 FROM local WHERE id = v_local) THEN
    v_local := NULL;
  END IF;
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
