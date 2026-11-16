-- Cuenta del cliente de la app móvil con correo y contraseña. Va unida a un "cliente" (el mismo que usan los
-- turnos, el historial y las faltas); el teléfono del cliente es opcional.
CREATE TABLE cuenta_app (
    cliente_id        integer      PRIMARY KEY REFERENCES cliente (id) ON DELETE CASCADE,
    correo            text         NOT NULL,
    clave_hash        text         NOT NULL,
    intentos_fallidos integer      NOT NULL DEFAULT 0,
    bloqueada_hasta   timestamp(3),
    creada_at         timestamp(3) NOT NULL,
    ultimo_ingreso_at timestamp(3)
);

-- Un correo, una cuenta (sin distinguir mayúsculas)
CREATE UNIQUE INDEX ux_cuenta_app_correo ON cuenta_app (lower(correo));
