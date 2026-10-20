-- Registro de publicaciones de eventos de Spring Modulith (outbox): cada evento que escucha otro módulo
-- queda guardado aquí en la misma transacción que lo produjo y se marca completo al procesarse.
-- Esquema v2 de spring-modulith-events-jdbc 2.x para PostgreSQL.
CREATE TABLE IF NOT EXISTS event_publication
(
  id                     UUID NOT NULL,
  listener_id            TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  serialized_event       TEXT NOT NULL,
  publication_date       TIMESTAMP WITH TIME ZONE NOT NULL,
  completion_date        TIMESTAMP WITH TIME ZONE,
  status                 TEXT,
  completion_attempts    INT,
  last_resubmission_date TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS event_publication_serialized_event_hash_idx ON event_publication USING hash(serialized_event);
CREATE INDEX IF NOT EXISTS event_publication_by_completion_date_idx ON event_publication (completion_date);
