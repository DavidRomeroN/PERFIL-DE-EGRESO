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

echo "🗄️  Aplicando migraciones…"
node ./node_modules/prisma/build/index.js migrate deploy

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "🌱 Cargando datos de demostración…"
  node ./node_modules/tsx/dist/cli.mjs prisma/seed.ts
fi

echo "🚀 Iniciando TurnoYa en el puerto ${PORT:-3000}"
exec "$@"
