-- Se retira el chatbot de WhatsApp (M4): el módulo deja de existir en los planes y en los locales, y se borran sus tablas.
-- Los avisos por WhatsApp (notificaciones) no cambian. El valor 'M4' queda en el tipo "ModuloCodigo" (PostgreSQL no permite
-- quitar valores de un enum sin recrearlo), pero ya no se usa.
DELETE FROM "local_modulo" WHERE "modulo" = 'M4';
DELETE FROM "plan_modulo" WHERE "modulo" = 'M4';

DROP TABLE IF EXISTS "evento_bot_procesado";
DROP TABLE IF EXISTS "mensaje_bot";
DROP TABLE IF EXISTS "conversacion_bot";
DROP TABLE IF EXISTS "canal_whatsapp";
DROP TYPE IF EXISTS "EstadoBot";
DROP TYPE IF EXISTS "DireccionMensaje";
