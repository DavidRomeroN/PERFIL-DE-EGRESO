#!/bin/sh
# Arranque del contenedor TurnoYa:
#  1) espera a PostgreSQL, 2) aplica migraciones, 3) (opcional) carga datos demo, 4) inicia Next.
set -e

echo "⏳ Esperando a la base de datos…"
i=0
until node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then echo "❌ No se pudo conectar a la base de datos"; exit 1; fi
  sleep 2
done
echo "✅ Base de datos disponible"

# El pooler de Neon (hostname con "-pooler") no sostiene el advisory lock de
# Prisma Migrate y la migración termina en P1002. Para migrar se usa el host directo.
MIGRATE_URL=$(node -e "
try {
  const u = new URL(process.env.DATABASE_URL);
  u.hostname = u.hostname.replace('-pooler', '');
  process.stdout.write(u.toString());
} catch {
  process.stdout.write(process.env.DATABASE_URL || '');
}
")

echo "🗄️  Aplicando migraciones…"
ok=0
for intento in 1 2 3 4 5; do
  # Prisma (schema, migraciones y prisma.config.ts) vive en backend/
  if (cd backend && DATABASE_URL="$MIGRATE_URL" PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=1 node ../node_modules/prisma/build/index.js migrate deploy); then
    ok=1
    break
  fi
  echo "⚠️  Migración falló (intento ${intento}/5). Reintentando en 8s…"
  sleep 8
done
if [ "$ok" -ne 1 ]; then
  echo "❌ No se pudieron aplicar las migraciones"
  exit 1
fi

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "🌱 Cargando datos de demostración…"
  # Desde backend/ para que tsx use backend/tsconfig.json (alias @backend/*)
  (cd backend && node ../node_modules/tsx/dist/cli.mjs prisma/seed.ts)
fi

echo "🚀 Iniciando TurnoYa en el puerto ${PORT:-3000}"
exec "$@"
