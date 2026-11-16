-- Planes para negocios pequeños (salón de belleza, consultorio de dos médicos) y WhatsApp con el número de cada negocio.

-- Gratis: una cola y avisos por WhatsApp con el número propio del negocio (OpenWA no cobra por mensaje).
UPDATE plan SET whatsapp_habilitado = true, max_avisos_whatsapp = 300,
       descripcion = '1 cola, 1 ventanilla, hasta 300 turnos/mes, avisos por WhatsApp con tu número, llamados desde el celular'
 WHERE codigo = 'GRATIS';

-- Emprende: más barato; sin transferencias (simulador, analítica, transferencias y predicción quedan para Pro).
UPDATE plan SET precio_mensual = 49.00,
       descripcion = '3 colas, 3 ventanillas, citas, prioridades, pantalla TV, 1 000 avisos por WhatsApp'
 WHERE codigo = 'EMPRENDE';

DELETE FROM plan_modulo pm USING plan p
 WHERE pm.plan_id = p.id AND p.codigo <> 'PRO' AND pm.modulo IN ('M2', 'M6', 'M7', 'M8');

-- Número de WhatsApp con que cada negocio envía sus avisos (sesión propia en OpenWA, vinculada con código).
CREATE TABLE whatsapp_local (
    local_id      integer PRIMARY KEY REFERENCES local (id) ON DELETE CASCADE,
    numero        varchar(20) NOT NULL,
    actualizado_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
