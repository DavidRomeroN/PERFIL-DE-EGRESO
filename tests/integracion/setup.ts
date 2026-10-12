/**
 * Preparación de las pruebas de integración (F0). Se importa PRIMERO en cada archivo:
 * apunta a la BD de pruebas, apaga los jobs y usa el proveedor de WhatsApp simulado.
 *
 *   TEST_DATABASE_URL (por defecto postgresql://turnoya:turnoya@localhost:5432/turnoya_test)
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://turnoya:turnoya@localhost:5432/turnoya_test?schema=public";
process.env.ENABLE_JOBS = "false";
process.env.WHATSAPP_PROVIDER = "mock";
process.env.LOG_LEVEL = "error";
process.env.DATA_ENCRYPTION_KEY ??= "clave-de-pruebas-turnoya-0123456789abcdef";
process.env.JWT_SECRET ??= "secreto-de-pruebas-turnoya-0123456789abcdef";
(process.env as Record<string, string>).NODE_ENV = "test";
