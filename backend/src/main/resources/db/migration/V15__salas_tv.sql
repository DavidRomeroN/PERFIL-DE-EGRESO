-- Salas de TV combinadas (varias colas en un mismo televisor) que el administrador guarda con nombre y puede eliminar.
-- Los enlaces "Todo el local" y "una cola" no se guardan: salen de las colas activas.
CREATE TABLE sala_tv (
  id         SERIAL PRIMARY KEY,
  local_id   INT          NOT NULL REFERENCES local (id) ON DELETE CASCADE,
  nombre     TEXT         NOT NULL,
  cola_ids   INT[]        NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX sala_tv_local_idx ON sala_tv (local_id);
