# TurnoYa — Arquitectura (estado real del código)

> Complementa [`PLAN_INTEGRAL.md`](PLAN_INTEGRAL.md) (lo planificado) y [`modulos/M1…M8`](modulos/) (especificación por módulo).
> Aquí: **cómo quedó implementado**, las decisiones que cambiaron respecto del plan y cómo verificarlo.

## 1. Vista general

```
Navegador (cliente, TV, panel, admin, kiosco PWA)
      │  HTTP /api/v1 (JSON, zod)          SSE /api/v1/realtime/:slug
      ▼
Next.js 16 (App Router, una instancia)
  ├─ frontend/src/app/api/v1/**       rutas delgadas: validan (zod), resuelven el local de la sesión y llaman a servicios
  ├─ backend/src/<modulo>/reglas.ts   lógica PURA (sin I/O) — 100 % probada con node:test
  ├─ backend/src/<modulo>/service.ts  casos de uso (Prisma + SQL)
  ├─ backend/src/jobs/                planificador (F1) y tabla de jobs
  └─ frontend/src/instrumentation.ts  arranque: valida secretos (F7) y lanza los jobs
      ▼
PostgreSQL 16 (Prisma 7 + adapter-pg)
  funciones: emitir_turno (8 args), siguiente_turno, posicion_turno, recalcular_claves, calcular_clave_orden, tiempo_estimado
  trigger fn_auditoria (con actor, IP y request_id) · vista materializada mv_turno_franja
```

### Capas por módulo

| Módulo | Reglas puras | Servicio | Pantallas |
|---|---|---|---|
| M1 Prioridades | `prioridades/reglas.ts` | `prioridades/service.ts` + SQL `siguiente_turno` | `/admin/modulos/prioridades`, panel, `/l/[slug]` |
| M2 Predicción | `prediccion/modelos.ts`, `cuantiles.ts` | `prediccion/service.ts` | `/admin/modulos/prediccion`, `/t/[token]` |
| M3 Citas | `citas/reglas.ts` | `citas/service.ts` | `/admin/modulos/citas`, `/l/[slug]/citas`, `/c/[token]`, TV (PIN) |
| M4 Chatbot | `bot/intencion.ts`, `bot/fsm.ts`, `bot/adaptadores.ts` | `bot/service.ts` | `/admin/bandeja` |
| M5 Kiosco | `kiosco/reglas.ts` | `kiosco/service.ts`, `kiosco/almacen.ts` (IndexedDB) | `/kiosco`, `/admin/modulos/kiosco`, `/k/...` |
| M6 Balanceo | `balanceo/reglas.ts` | `balanceo/service.ts` | `/admin/modulos/balanceo`, panel (transferir) |
| M7 Analítica | `analitica/sla.ts`, `analitica/reglas.ts` | `analitica/consultas.ts`, `alertas.ts`, `reportes.ts` | `/admin/analitica` |
| M8 Simulador | `capacidad/erlang.ts`, `capacidad/des.ts` | `capacidad/service.ts`, `simulador.worker.ts` | `/admin/simulador` |

## 2. Decisiones que cambiaron respecto del plan

| Plan | Implementado | Por qué |
|---|---|---|
| ADR-01 `pg-boss` | **Planificador propio** (`backend/src/jobs/scheduler.ts`): cada job se reclama con `UPDATE job_estado … WHERE proxima <= now() RETURNING` | Misma garantía (una sola corrida aunque haya varias instancias) sin un esquema extra ni dependencias; el estado es visible en `/admin/jobs` y `/api/health`. Si se pierde una corrida (servidor apagado), corre una vez al volver. |
| ADR-02 bus `LISTEN/NOTIFY` (F2) | Bus en memoria (`realtime.ts`) | La app corre en **una** instancia (Docker). La API `publicar/suscribir` no cambia: se puede reemplazar el interior si se escala. |
| F0 Vitest + Testcontainers | `node:test` + `tsx`, BD `turnoya_test` en el mismo contenedor | Ya era el runner del repo; sin dependencias nuevas. CI levanta PostgreSQL como servicio. |
| M7 `@react-pdf/renderer` | `pdf-lib` | Sin JSX en el servidor ni fuentes externas; PDF de varias páginas con barras y mapa de calor. |
| M5 `dispositivo.id` UUID | `SERIAL` | Más simple de mostrar (K1, K2…); el token del dispositivo sigue siendo de 32 bytes y solo se guarda su hash. |
| M3 `local.checkin_secret` | Secreto del PIN derivado de `DATA_ENCRYPTION_KEY` + local | Nada secreto en la BD; cambia si se rota la clave. |
| Expiración RN04 activada por defecto | **Opt-in** (`tiempo_ausencia_seg = NULL` desactiva) | Regla de oro §3.1: módulo/función apagada = comportamiento original. |

## 3. Garantías y dónde se prueban

| Garantía | Cómo | Prueba |
|---|---|---|
| Dos ventanillas nunca llaman el mismo turno (C2) | `siguiente_turno` con `FOR UPDATE SKIP LOCKED` + reintento si la fila está bloqueada un instante | `backend/tests/integracion/nucleo.test.ts` (3 ventanillas concurrentes) |
| Prioridad sin inanición (M1) | clave estable `peso − α·minutos` + tope de adelantos | `backend/tests/unit/prioridades.test.ts` (propiedades P1–P4) |
| Citas sin sobrecupo (M3) | un solo `UPDATE slot … WHERE reservados < capacidad` + `INSERT` | 50 reservas simultáneas ⇒ 3 |
| Un celular = un cliente | índice único parcial `ux_cliente_telefono_hash` + `INSERT … ON CONFLICT` | reservas simultáneas del mismo celular |
| Bot: cada mensaje una sola vez (M4) | `evento_bot_procesado` + candado por (local, teléfono) | mensaje duplicado ⇒ 1 turno |
| Kiosco: exactamente una vez (M5) | clave de idempotencia por pulsación guardada en IndexedDB antes de la red + `clave_idem` única | lote repetido 3 veces ⇒ 3 turnos |
| Predicción sin fuga de datos (M2) | replay cronológico: el estado solo aprende de eventos pasados | `backend/tests/unit/prediccion.test.ts` |
| Alertas sin duplicados (M7) | índice único parcial por huella + candado consultivo por local | evaluaciones concurrentes ⇒ 1 alerta |
| Aislamiento entre locales | `enLocal()` toma el local de la sesión, nunca del cuerpo; módulos exigen bandera | rutas `backend/src/rutas.ts`; prueba D1 del bot |
| Privacidad (Ley 29733) | categoría solo para el personal; teléfonos cifrados + hash; purga a 90 días; SSE público sin texto de avisos | snapshot público sin categoría |

## 4. Seguridad (F7)

- `instrumentation.ts` **no arranca en producción** si `JWT_SECRET` o `DATA_ENCRYPTION_KEY` faltan, son de ejemplo o tienen menos de 32 caracteres (`ALLOW_INSECURE_SECRETS=true` solo para demos).
  ⚠ El `.env` local de desarrollo usa la clave de ejemplo: antes de desplegar hay que generar una nueva **y volver a cifrar** los teléfonos guardados (o partir de una BD limpia).
- Límite de peticiones persistente (`rate_limit`), bloqueo de login tras 5 fallos (15 min), CSP, `Permissions-Policy`, HSTS en producción.
- Kiosco: token de dispositivo (hash), código de emparejamiento de un uso; service worker limitado a `/kiosco` y sin caché de la API.

## 5. Operación

```bash
docker compose up -d db
npm install && npm run db:migrate
npm run db:seed              # demo (borra todo)
npm run db:seed:historico    # 60 días de histórico para M2/M7/M8
npm run dev                  # jobs incluidos (ENABLE_JOBS=false para apagarlos)
npm test                     # 85 pruebas unitarias
npm run db:test:prepare && npm run test:int   # 27 pruebas de integración (BD turnoya_test)
```

Observabilidad: `/api/health` (BD y jobs atrasados), `/api/metrics` (Prometheus; sesión de super-admin o `METRICS_TOKEN`), logs JSON con `request_id`, auditoría en `/admin/auditoria`.
