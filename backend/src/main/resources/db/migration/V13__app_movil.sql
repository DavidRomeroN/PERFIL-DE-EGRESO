-- App móvil del cliente: verificación del celular por código, sesiones de la app y dispositivo de cada turno.

-- Código de verificación vigente de un celular (uno a la vez). Nunca se guarda el código, solo su hash.
CREATE TABLE app_codigo (
    telefono_hash TEXT PRIMARY KEY,
    codigo_hash   TEXT NOT NULL,
    intentos      INTEGER NOT NULL DEFAULT 0,
    expira_at     TIMESTAMP(3) NOT NULL,
    creado_at     TIMESTAMP(3) NOT NULL
);

-- Sesión de la app: el teléfono guarda el token; aquí solo queda su hash.
CREATE TABLE app_sesion (
    id               SERIAL PRIMARY KEY,
    token_hash       TEXT NOT NULL UNIQUE,
    cliente_id       INTEGER NOT NULL REFERENCES cliente (id) ON DELETE CASCADE,
    dispositivo_hash TEXT,
    creada_at        TIMESTAMP(3) NOT NULL,
    ultimo_uso_at    TIMESTAMP(3) NOT NULL,
    revocada_at      TIMESTAMP(3)
);
CREATE INDEX ix_app_sesion_cliente ON app_sesion (cliente_id);

-- Dispositivo (hash de su identificador) que tomó cada turno de la app: un turno activo por dispositivo y cola.
CREATE TABLE turno_app (
    turno_id         INTEGER PRIMARY KEY REFERENCES turno (id) ON DELETE CASCADE,
    dispositivo_hash TEXT NOT NULL,
    creado_at        TIMESTAMP(3) NOT NULL
);
CREATE INDEX ix_turno_app_dispositivo ON turno_app (dispositivo_hash);
