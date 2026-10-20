# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# TurnoYa — imagen de producción (monorepo: backend/ + frontend/)
# Next.js standalone (frontend/) + Prisma, migraciones y seed (backend/)
# ---------------------------------------------------------------------------

# 1) Dependencias (npm workspaces: se instalan todas en /app/node_modules)
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY backend/prisma ./backend/prisma
COPY backend/prisma.config.ts ./backend/prisma.config.ts
# postinstall ejecuta `prisma generate`; necesita el schema (ya copiado)
RUN npm ci --ignore-scripts && npm run db:generate -w backend

# 2) Build
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# El cliente generado vive en backend/src/generated/prisma (ya producido en deps)
COPY --from=deps /app/backend/src/generated ./backend/src/generated
ENV NEXT_TELEMETRY_DISABLED=1
# Variables públicas necesarias en build (se pueden sobreescribir en runtime para SSR)
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# Solo para que `next build` no falle al importar Prisma. No se conecta a ninguna base.
# En Render, la DATABASE_URL real se inyecta al arrancar el contenedor.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
RUN npm run build -w frontend

# 3) Runtime
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Salida standalone de Next. Con outputFileTracingRoot = raíz del monorepo, el servidor queda en frontend/server.js
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder /app/frontend/public ./frontend/public

# Prisma CLI + tsx + migraciones + seed (para `migrate deploy` y seed al arrancar).
# Se copian las dependencias completas: incluye el CLI de Prisma y tsx.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/backend/prisma ./backend/prisma
COPY --from=builder --chown=nextjs:nodejs /app/backend/prisma.config.ts ./backend/prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/backend/src ./backend/src
COPY --from=builder --chown=nextjs:nodejs /app/backend/package.json ./backend/package.json
COPY --from=builder --chown=nextjs:nodejs /app/backend/tsconfig.json ./backend/tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "frontend/server.js"]
