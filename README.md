# TurnoYa — Sistema de Fila Virtual y Turnos para Salas de Espera

SaaS multi-local que reemplaza la fila física por una **fila virtual**: el cliente escanea un QR, toma su turno desde el celular, recibe un aviso por WhatsApp cuando faltan pocas personas y es llamado en una pantalla TV en tiempo real. Incluye panel de ventanilla para operadores, administración por local (colas, ventanillas, usuarios, reportes, personalización de TV) y super-administración de locales y planes.

> Proyecto de Perfil de Egreso — Universidad Peruana Unión, Filial Juliaca.

---

## 1. Inicio rápido (desarrollo)

Requisitos: **Node.js 22+**, **Docker Desktop** (para PostgreSQL) y npm.

```bash
# 1) Dependencias
npm install

# 2) Variables de entorno
copy .env.example .env        # (Linux/macOS: cp .env.example .env)

# 3) Base de datos + migraciones + datos de demostración
npm run setup                 # = docker compose up -d db && prisma migrate deploy && prisma db seed

# 4) Servidor de desarrollo
npm run dev                   # http://localhost:3000
```

### Credenciales de demostración

| Rol          | Usuario                      | Contraseña    | Local                     |
| ------------ | ---------------------------- | ------------- | ------------------------- |
| Super admin  | `superadmin@turnoya.pe`      | `admin123`    | Todos                     |
| Admin local  | `admin@policlinico.pe`       | `admin123`    | Policlínico San Román     |
| Operador     | `operador@policlinico.pe`    | `operador123` | Policlínico San Román     |
| Admin local  | `admin@transportes.pe`       | `admin123`    | Transportes Altiplano     |
| Operador     | `operador@transportes.pe`    | `operador123` | Transportes Altiplano     |

### Recorrido sugerido para la demo

1. **Cliente** — `http://localhost:3000/l/policlinico-san-roman` → elige cola → ingresa nombre y celular → recibe código (`A-023`) y página de seguimiento `/t/<token>` con posición, tiempo estimado y burbujas WhatsApp.
2. **Pantalla TV** — `http://localhost:3000/l/policlinico-san-roman/tv` (pantalla completa, sonido y voz).
3. **Operador** — `/login` → `operador@policlinico.pe` → *Panel de ventanilla*: **Llamar siguiente**, Atendido, Rellamar, No se presentó, emitir ticket impreso.
4. **Admin** — `/login` → `admin@policlinico.pe` → dashboard con KPIs y gráficos, colas, ventanillas, usuarios, reportes (CSV), notificaciones, pantalla/QR y configuración.
5. **Super admin** — `superadmin@turnoya.pe` → *Locales y planes*: alta de locales, cambio de plan, límites por plan.

Todo se actualiza en **tiempo real** entre pestañas (SSE): abre la TV, el panel y la página del cliente en paralelo.

---

## 2. Arquitectura

```
┌─────────────┐   HTTPS    ┌──────────────────────────────────────────┐    ┌──────────────┐
│ Celular     │──QR/PWA──▶ │  Next.js 16 (App Router, React 19)       │    │ PostgreSQL 16│
│ Pantalla TV │◀──SSE────  │  · UI (Tailwind v4 + shadcn/ui)          │◀──▶│ · emitir_turno│
│ Panel/Admin │──REST────▶ │  · API REST /api/v1 (zod, JWT, rate-limit)│    │ · tiempo_est. │
└─────────────┘            │  · Dominio: turnos, estados, avisos       │    │ · auditoría   │
                           │  · Bus de eventos → Server-Sent Events    │    └──────────────┘
                           │  · WhatsApp (mock | Meta Cloud API)       │
                           └──────────────────────────────────────────┘
```

| Capa          | Tecnología                                                                 |
| ------------- | -------------------------------------------------------------------------- |
| Front-end     | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts, lucide-react, qrcode.react, PWA manifest |
| Back-end      | Next.js Route Handlers (`/api/v1`), zod 4, jose (JWT HS256), bcryptjs      |
| Datos         | PostgreSQL 16, Prisma ORM 7 (driver adapter `pg`), funciones SQL y triggers |
| Tiempo real   | Server-Sent Events (`/api/v1/realtime/:slug`) + polling de respaldo       |
| Mensajería    | Patrón *strategy*: `mock` (simulador) / `openwa` (gateway open source [OpenWA](https://github.com/rmyndharis/OpenWA), número propio por QR) / `meta` (WhatsApp Cloud API); webhook de estados firmado (HMAC) |
| Despliegue    | Docker multi-stage (Next standalone) + docker compose                      |

### Estructura de carpetas

Monorepo con **npm workspaces**: `backend/` (`@turnoya/backend`) y `frontend/` (`@turnoya/frontend`). Los comandos se ejecutan desde la raíz y el `.env` vive en la raíz (lo leen ambos).

```
backend/                 lógica de servidor (se importa como @backend/*)
  ├─ src/                  dominio y servicios por módulo (turnos, auth, crypto, realtime, whatsapp, api, schemas,
  │                        prioridades, prediccion, citas, bot, kiosco, balanceo, analitica, capacidad, pagos, jobs)
  ├─ prisma/               schema.prisma, migraciones (incl. funciones SQL), seed.ts
  ├─ tests/                unit (lógica pura) e integracion (BD turnoya_test)
  └─ scripts/              bd-pruebas.mjs (prepara la BD de pruebas)
frontend/                aplicación Next.js
  ├─ src/app/              rutas App Router
  │   ├─ page.tsx            landing
  │   ├─ l/[slug]            tomar turno (QR) · l/[slug]/tv pantalla TV
  │   ├─ t/[token]           seguimiento del turno (cliente)
  │   ├─ ticket/[token]      ticket imprimible 80 mm
  │   ├─ login, panel        autenticación y panel de ventanilla
  │   ├─ admin/**            dashboard, colas, ventanillas, usuarios, reportes, notificaciones, pantalla, configuración, locales
  │   └─ api/v1/**           API REST + SSE + webhooks (rutas delgadas que llaman a @backend/*)
  ├─ src/lib/              solo navegador: utils (cn), format, fetcher, kiosco/almacen (IndexedDB), worker del simulador
  ├─ src/components/       ui (shadcn), app (header, stat cards, diálogos), brand (logo)
  ├─ src/hooks/            useRealtime (SSE), useSonido (timbre + voz)
  └─ public/               estáticos y service worker del kiosco
docs/                    arquitectura, módulos, plan de migración y manual de usuario
video-promo/             video promocional (Remotion), proyecto independiente
```

> El backend todavía depende de `next/server` y `next/headers` (capa HTTP en `api.ts`, `auth.ts`, `admin.ts`, `rutas.ts`). Esa dependencia desaparece al migrar a Spring Boot (ver [`docs/MIGRACION_SPRING.md`](docs/MIGRACION_SPRING.md)).

### Modelo de datos (resumen)

`plan` → `local` → { `usuario`, `cola` → `contador_cola`, `ventanilla` } ; `turno` (local, cola, ventanilla, cliente) → `notificacion` ; `auditoria`.

- `emitir_turno(cola, cliente, canal, token, fecha)` — función SQL atómica: *upsert* del contador diario y creación del turno (RN01).
- `tiempo_estimado(cola, posicion)` — posición × promedio móvil de los últimos 10 tiempos de atención (RN02).
- Índice único parcial `ux_turno_activo_cliente` — un solo turno activo por celular y cola (RN03).
- Triggers `fn_auditoria` sobre `turno` y `usuario`.

### Máquina de estados del turno

`EMITIDO → AVISADO → LLAMADO → ATENDIDO | NO_SE_PRESENTO`, además `EMITIDO/AVISADO → CANCELADO` (cliente) y `LLAMADO → LLAMADO` (rellamada, contador `rellamadas`). Toda transición inválida devuelve `409 TRANSICION_INVALIDA`.

---

## 3. API REST (`/api/v1`)

Respuesta uniforme `{ ok: true, data }` / `{ ok: false, error: { codigo, mensaje } }`.

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET  | `/public/locales/:slug` | público | Datos del local y colas activas |
| GET  | `/public/locales/:slug/estado` | público | Snapshot de colas (TV) |
| POST | `/public/turnos` | público (5/min/IP) | Emitir turno por QR |
| GET / DELETE | `/public/turnos/:token` | público | Seguir / cancelar turno |
| GET  | `/realtime/:slug` | público | Server-Sent Events |
| POST | `/auth/login`, `/auth/logout` · GET `/auth/me` | — | Sesión JWT en cookie httpOnly |
| GET  | `/panel/estado` | operador+ | Snapshot con nombres para la ventanilla |
| POST | `/ventanillas/:id/llamar-siguiente` | operador+ | Llamar siguiente (cierra el anterior como ATENDIDO) |
| PATCH | `/turnos/:id/estado` | operador+ | ATENDIDO / NO_SE_PRESENTO / LLAMADO (rellamar) |
| POST | `/turnos/ticket` | operador+ | Emitir ticket impreso |
| CRUD | `/colas`, `/ventanillas`, `/usuarios` | admin local+ | Gestión del local |
| GET / PATCH | `/local` | admin local+ | Configuración y personalización TV |
| GET  | `/reportes/espera?desde&hasta&formato=csv` | admin local+ | Reporte y exportación CSV |
| GET  | `/notificaciones` | admin local+ | Bandeja de avisos WhatsApp |
| CRUD | `/locales`, `/locales/:id`, POST `/locales/activo` | super admin | Multi-tenant |
| GET  | `/planes` | público | Planes Gratis / Emprende / Pro |
| GET / POST | `/webhooks/whatsapp` | OpenWA / Meta | Estados de entrega (`message.ack` de OpenWA o `statuses` de Meta), firma HMAC |
| GET / POST | `/whatsapp/conexion` | admin local+ | Estado del número en OpenWA, QR de vinculación, iniciar/detener/desvincular, registrar webhook, mensaje de prueba |
| GET  | `/api/health` | público | Estado de la app y la BD |

Códigos de error: `VALIDACION`, `RATE_LIMIT`, `NO_AUTENTICADO`, `PROHIBIDO`, `CREDENCIALES_INVALIDAS`, `NO_ENCONTRADO`, `LOCAL_NO_ENCONTRADO`, `SIN_LOCAL`, `DUPLICADO`, `COLA_INACTIVA`, `TURNO_DUPLICADO`, `LIMITE_PLAN`, `TRANSICION_INVALIDA`, `ERROR_INTERNO`.

---

## 4. Trazabilidad con el documento del proyecto

| Requisito | Implementación |
| --- | --- |
| RF01 Tomar turno por QR | `/l/[slug]` + `POST /public/turnos` |
| RF02 Seguimiento del turno | `/t/[token]` (posición, tiempo estimado, estado en vivo) |
| RF03 Aviso WhatsApp al faltar N personas | `revisarAvisos()` + proveedor WhatsApp (OpenWA real / Meta / simulador), N configurable por local (`avisarFaltando`) |
| RF04 Pantalla TV en tiempo real | `/l/[slug]/tv` con SSE, timbre y voz |
| RF05 Panel de ventanilla | `/panel`: llamar siguiente, atendido, no se presentó, rellamar, ticket |
| RF06 Gestión de colas y ventanillas | `/admin/colas`, `/admin/ventanillas` |
| RF07 Usuarios y roles | `/admin/usuarios`, roles SUPER_ADMIN / ADMIN_LOCAL / OPERADOR |
| RF08 Reportes y CSV | `/admin/reportes`, `GET /reportes/espera?formato=csv` |
| RF09 Personalización de TV y QR | `/admin/pantalla` (color, logo, mensajes, afiche QR) |
| RF10 Ticket impreso (sin celular) | `/ticket/[token]` 80 mm |
| RF11 Multi-local y planes | `/admin/locales`, límites por plan (`LIMITE_PLAN`) |
| RF12 Bandeja de notificaciones | `/admin/notificaciones` |
| RN01 Numeración diaria por cola | `contador_cola` + `emitir_turno()` |
| RN02 Tiempo estimado | `tiempo_estimado()` (promedio móvil de 10) |
| RN03 Un turno activo por celular/cola | hash del teléfono + índice único parcial |
| RN04 No se presentó a los 3 min | temporizador y alerta en el panel (≥180 s) |
| RN05 Plan Gratis sin WhatsApp y ≤300 turnos/mes | validación en `emitirTurno()` y en proveedor |
| Ley N.° 29733 | consentimiento explícito, celular cifrado AES-256-GCM + hash SHA-256, enmascarado en UI, `purgarDatosPersonales(90)` |

---

## 5. Despliegue en producción (Docker)

```bash
# Variables (opcional: .env en la raíz con JWT_SECRET, DATA_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL, WHATSAPP_*)
docker compose --profile prod up -d --build
```

El contenedor `app` espera a PostgreSQL, ejecuta `prisma migrate deploy`, carga los datos demo si `SEED_ON_START=true` (por defecto) y arranca Next en modo *standalone* en el puerto 3000. Para una instancia limpia usa `SEED_ON_START=false`. El perfil `prod` también levanta el gateway `openwa` (puerto 2785); activa `WHATSAPP_PROVIDER=openwa` para usarlo.

### Variables de entorno

| Variable | Descripción |
| --- | --- |
| `DATABASE_URL` | Cadena de conexión PostgreSQL |
| `JWT_SECRET` | Secreto para firmar sesiones (≥ 32 caracteres) |
| `DATA_ENCRYPTION_KEY` | Clave AES-256 (32 bytes) para cifrar celulares |
| `NEXT_PUBLIC_APP_URL` | URL pública (QR y enlaces de WhatsApp) |
| `WHATSAPP_PROVIDER` | `mock` (simulador), `openwa` (gateway OpenWA) o `meta` (WhatsApp Cloud API) |
| `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION`, `OPENWA_WEBHOOK_SECRET`, `OPENWA_WEBHOOK_BASE_URL` | Conexión al gateway OpenWA (solo con `openwa`) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Credenciales Meta (solo con `meta`) |
| `SEED_ON_START` | `true` para cargar datos demo al arrancar el contenedor |

### WhatsApp real con OpenWA (número propio, sin costo)

[OpenWA](https://github.com/rmyndharis/OpenWA) es un gateway de WhatsApp open source y auto-hospedado (MIT). TurnoYa lo integra como proveedor `openwa`: envía el texto de los avisos por `POST /api/sessions/{sesion}/messages/send-text` y recibe los acks (`message.ack`) por webhook firmado con HMAC-SHA256 (`X-OpenWA-Signature`).

```bash
# 1) Levantar el gateway (puerto 2785; dashboard en http://localhost:2785)
docker compose --profile whatsapp up -d

# 2) En .env
WHATSAPP_PROVIDER="openwa"
OPENWA_API_KEY="…"              # el mismo valor siembra la clave admin de OpenWA (API_MASTER_KEY)
OPENWA_WEBHOOK_SECRET="…"        # ≥ 16 caracteres
OPENWA_WEBHOOK_BASE_URL="http://host.docker.internal:3000"   # en producción Docker: http://app:3000

# 3) Reiniciar `npm run dev` y entrar a Admin → Avisos WhatsApp
```

En **Admin → Avisos WhatsApp** aparece la tarjeta *Número de WhatsApp (OpenWA)*: pulsa **Vincular número**, escanea el QR desde WhatsApp (Dispositivos vinculados → Vincular un dispositivo), pulsa **Registrar** webhook y envía un **mensaje de prueba**. A partir de ahí los avisos `turno_proximo` y `turno_llamado` salen por ese número y los estados enviado → entregado → leído llegan en tiempo real.

Recomendaciones de OpenWA (es un cliente no oficial): usa un **número dedicado** (no el personal), "caliéntalo" unos días antes de la demo y envía solo a personas que dieron su consentimiento (exactamente el flujo de TurnoYa). Para entornos regulados usa la Cloud API oficial.

### WhatsApp real (Meta Cloud API)

1. Crear app en Meta for Developers con el producto WhatsApp y aprobar las plantillas `turno_proximo` y `turno_llamado` (idioma `es`).
2. Configurar `WHATSAPP_PROVIDER=meta`, token, `PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` y el webhook `https://<dominio>/api/v1/webhooks/whatsapp` con `WHATSAPP_VERIFY_TOKEN`.
3. Los estados de entrega (enviado / entregado / leído) se reflejan en `/admin/notificaciones` y en la página del cliente.

---

## 6. Scripts

| Script | Acción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build y arranque de producción |
| `npm run typecheck` / `npm run lint` | Verificación TypeScript / ESLint |
| `npm run setup` | Levanta BD, migra y siembra |
| `npm run db:migrate` · `db:seed` · `db:reset` · `db:studio` | Utilidades Prisma |
| `npm run docker:prod` | Build y despliegue completo con Docker |
| `npm test` · `npm run test:int` | Pruebas unitarias e integración (`backend/tests`) |

Todos los scripts se lanzan desde la raíz y delegan en el workspace que corresponde (`-w backend` o `-w frontend`). Para agregar una dependencia, indica el workspace: `npm install <paquete> -w frontend`.

---

## Equipo

Nick Mayta · Jhan Ramos · David Romero · Henyelrey Garcia — EP Ingeniería de Sistemas, Universidad Peruana Unión, sede Juliaca. Emprendedorismo 2026-2.
