# TurnoYa — Plan integral de trabajo

> Versión 1.0 · 12/10/2026 · Repositorio `PERFIL-DE-EGRESO` · Equipo: Nick Mayta, Jhan Ramos, David Romero, Henyelrey Garcia
>
> **Estado real y lista de trabajo restante: [`PENDIENTE.md`](PENDIENTE.md).**
>
> Este es el documento maestro. Cada módulo avanzado tiene su propio archivo en `docs/modulos/` con el detalle técnico completo
> (datos, algoritmos, API, UI, pruebas, criterios de aceptación, tareas). El prototipo está en Figma (`TurnoYa - Prototipo`).

## Índice

0. [Cómo usar este documento](#0-cómo-usar-este-documento)
1. [Qué es TurnoYa hoy (inventario verificado en el código)](#1-qué-es-turnoya-hoy)
2. [Equipo, reparto y responsabilidades](#2-equipo-reparto-y-responsabilidades)
3. [Decisiones de arquitectura transversales (ADR)](#3-decisiones-de-arquitectura-transversales)
4. [Fundaciones (trabajo previo común)](#4-fundaciones-trabajo-previo-común)
5. [Brechas del núcleo a cerrar](#5-brechas-del-núcleo-a-cerrar)
6. [Los 8 módulos avanzados](#6-los-8-módulos-avanzados)
7. [Matriz de planes y módulos](#7-matriz-de-planes-y-módulos)
8. [Estrategia de pruebas y calidad](#8-estrategia-de-pruebas-y-calidad)
9. [Seguridad, privacidad y cumplimiento](#9-seguridad-privacidad-y-cumplimiento)
10. [DevOps, CI/CD y operación](#10-devops-cicd-y-operación)
11. [Cronograma y estimación](#11-cronograma-y-estimación)
12. [Prototipo Figma: estado y pendientes](#12-prototipo-figma-estado-y-pendientes)
13. [Entregables académicos](#13-entregables-académicos)
14. [Flujo de trabajo del equipo (Git, PR, Definition of Done)](#14-flujo-de-trabajo-del-equipo)
15. [Riesgos globales](#15-riesgos-globales)
16. [Apéndices](#16-apéndices)

---

## 0. Cómo usar este documento

- **Identificadores.** Requisitos funcionales `RF-Mx-nn`, reglas de negocio `RN-Mx-nn`, requisitos no funcionales `RNF-Mx-nn`,
  tareas `Mx-Tnn`, fundaciones `Fnn`, brechas del núcleo `Nnn`. Los existentes del proyecto original (RF01–RF12, RN01–RN05, RNF08)
  se conservan tal cual.
- **Estimaciones** en horas-persona, orientativas (±25 %). El total por integrante busca estar cerca de 156 h (≈ 626 h en total sin contar la tarea opcional N10).
- **Estado de cada tarea:** `[ ]` pendiente · `[~]` en curso · `[x]` hecha. Actualizar en el propio archivo en cada PR.
- **Next.js 16 no es el Next.js que conoce el modelo/IA ni la mayoría de tutoriales.** `AGENTS.md` del repo obliga a leer
  `node_modules/next/dist/docs/` antes de escribir código de rutas, caché, `instrumentation`, etc. Aplica a todos.

---

## 1. Qué es TurnoYa hoy

Verificado leyendo el repositorio (commit `eedf527`, rama principal).

### 1.1 Stack

| Capa | Tecnología (versión del `package.json`) |
|---|---|
| Front-end | Next.js 16.3.8 (App Router, Turbopack), React 19.2.8, TypeScript 5, Tailwind CSS 4, shadcn/ui sobre `@base-ui/react`, lucide-react, recharts 3, sonner, qrcode.react |
| Back-end | Route Handlers en `frontend/src/app/api/v1/**`, zod 4, jose (JWT HS256 en cookie httpOnly), bcryptjs |
| Datos | PostgreSQL 16, Prisma 7.10 con `@prisma/adapter-pg`, funciones SQL, vista, triggers |
| Tiempo real | Server-Sent Events (`/api/v1/realtime/:slug`) sobre un `EventEmitter` en memoria |
| Mensajería | Patrón estrategia: `mock` · `openwa` (gateway auto-hospedado) · `meta` (Cloud API) |
| Despliegue | Docker multi-stage (standalone) + docker compose (`db`, `app`, `openwa`) |

### 1.2 Modelo de datos actual (9 tablas + `contador_cola`)

`plan → local → { usuario, cola → contador_cola, ventanilla }`, `turno (local, cola, ventanilla, cliente) → notificacion`, `auditoria`.

- **Estados del turno:** `EMITIDO → AVISADO → LLAMADO → ATENDIDO | NO_SE_PRESENTO`; `EMITIDO/AVISADO → CANCELADO`; `LLAMADO → LLAMADO` (rellamada).
  "En espera" = `EMITIDO` o `AVISADO`. Transiciones validadas en `TRANSICIONES` (`backend/src/turnos.ts`), error `409 TRANSICION_INVALIDA`.
- **Canales:** `QR`, `TICKET`. **Roles:** `SUPER_ADMIN`, `ADMIN_LOCAL`, `OPERADOR`.
- **Planes sembrados:**

  | Código | Precio | Turnos/mes | Colas | Ventanillas | WhatsApp | Avisos WA | Reportes |
  |---|---|---|---|---|---|---|---|
  | GRATIS | S/ 0 | 300 | 1 | 1 | no | 0 | no |
  | EMPRENDE | S/ 69 | 5 000 | 3 | 3 | sí | 1 000 | no |
  | PRO | S/ 149 | 100 000 | 99 | 10 | sí | 3 000 | sí |

- **Funciones SQL (`20261002194000_funciones_sql`):** `emitir_turno()` (upsert del contador diario ⇒ sin duplicados),
  `tiempo_estimado()` (posición × promedio de los últimos 10 ATENDIDO, mínimo 30 s, si no hay datos usa `tiempo_atencion_base`),
  vista `v_espera_diaria`, `fn_auditoria()` + triggers en `turno` y `usuario`, índice único parcial `ux_turno_activo_cliente` (RN03).
- **Datos personales:** teléfono cifrado AES-256-GCM + hash SHA-256 (`backend/src/crypto.ts`), enmascarado en UI, `purgarDatosPersonales(90)`.

### 1.3 Funciones de dominio (`backend/src/turnos.ts`, 668 líneas)

`emitirTurno` · `obtenerTurnoPorToken` (posición = `count(emitidoAt < mío)`) · `cancelarTurno` · `llamarSiguiente`
(`findFirst … orderBy emitidoAt asc`, cierra el anterior como ATENDIDO) · `cambiarEstadoTurno` · `revisarAvisos` (RF03, avisa cuando
`delante <= local.avisarFaltando`) · `notificarLlamado` · `snapshotLocal` · `reporteEspera` · `purgarDatosPersonales`.
Eventos de dominio por el bus: `cola:actualizada`, `turno:llamado`, `turno:estado`, `notificacion:nueva`.

### 1.4 Rutas existentes

- **UI pública:** `/` (landing con planes), `/l/[slug]` (tomar turno), `/l/[slug]/tv`, `/t/[token]` (seguimiento), `/ticket/[token]` (80 mm), `/login`.
- **UI staff:** `/panel` (ventanilla), `/admin` (dashboard), `/admin/{colas,ventanillas,usuarios,reportes,notificaciones,pantalla,configuracion,locales}`.
- **API `/api/v1`:** `public/locales/:slug[/estado]`, `public/turnos[/:token]`, `realtime/:slug`, `auth/{login,logout,me}`, `panel/estado`,
  `ventanillas[/:id[/llamar-siguiente]]`, `turnos/:id/estado`, `turnos/ticket`, `colas[/:id]`, `usuarios[/:id]`, `local`, `locales[/:id|activo]`,
  `planes`, `reportes/espera`, `notificaciones`, `webhooks/whatsapp`, `whatsapp/conexion`, `/api/health`.
- **Patrón de handlers:** `publico()` y `conRol([...], handler)` en `backend/src/api.ts`; respuesta `{ ok, data | error:{codigo,mensaje} }`; zod en `backend/src/schemas.ts`.

### 1.5 Brechas y deuda técnica detectadas

| # | Hallazgo | Evidencia | Impacto | Se resuelve en |
|---|---|---|---|---|
| B1 | El bus de eventos es un `EventEmitter` por proceso | `backend/src/realtime.ts` | Con 2 instancias de la app los SSE no se enteran de lo que pasó en la otra | F2 |
| B2 | Rate limit en memoria por proceso | `rateLimit()` en `backend/src/api.ts` | Se evade con varias instancias o reinicios | F7 |
| B3 | Secretos con valor por defecto inseguro | `JWT_SECRET ?? "turnoya-dev-secret…"`, `DATA_ENCRYPTION_KEY ?? "0123…"` | En producción sin variables, sesiones y cifrado triviales | F7 |
| B4 | No existe ningún job programado | `grep setInterval/cron` solo en UI | `purgarDatosPersonales(90)` nunca se ejecuta (incumple RNF08/Ley 29733); RN04 no cambia el estado solo | F1, N04, N09 |
| B5 | Auditoría sin actor y sin pantalla | `fn_auditoria` inserta `usuario_id = NULL`; no hay `/admin/auditoria` | No se sabe quién hizo qué | F4, N01 |
| B6 | Sin pruebas, sin CI, sin `.env.example` | `package.json` no tiene script de test; README pide `.env.example` que no existe | Regresiones invisibles; onboarding lento | F0 |
| B7 | Orden de atención FIFO rígido | `orderBy: [{ emitidoAt: "asc" }]` en `llamarSiguiente`; posición por `count` | Imposible priorizar o citar sin tocar el núcleo | M1 |
| B8 | Tiempo estimado ingenuo | `tiempo_estimado()` | Sin rango ni estacionalidad | M2 |
| B9 | Sin horario del local ni "cola cerrada" | solo `cola.activa` | No se puede agendar (M3) ni explicar al cliente por qué no hay turno | N05 |
| B10 | RN04 es solo visual | `excedido = segundosLlamado >= 180` en el panel | Turnos LLAMADO quedan abiertos si el operador no actúa | N04 |
| B11 | `emitir_turno()` no admite categoría, origen ni fecha de emisión | firma `(cola, cliente, canal, token, fecha)` | Bloquea M1, M3, M5, M6 | F5 |
| B12 | Colores: el local usa `#0f766e` (teal) por defecto y el prototipo Figma usa `#059669` (esmeralda) | `schema.prisma` vs Figma | Inconsistencia visual | Decidir en F9 |
| B13 | El prototipo Figma muestra planes "Básico/Pro/Empresa" con otros precios | Figma vs seed | Confusión en la demo | Corregir Figma (§12) |

### 1.6 Requisitos ya cubiertos (resumen de la trazabilidad del README)

RF01 tomar turno por QR · RF02 seguimiento · RF03 aviso WhatsApp · RF04 TV en tiempo real · RF05 panel de ventanilla · RF06 colas y ventanillas ·
RF07 usuarios y roles · RF08 reportes y CSV · RF09 personalización TV/QR · RF10 ticket impreso · RF11 multi-local y planes · RF12 bandeja de notificaciones ·
RN01 numeración diaria · RN02 tiempo estimado · RN03 un turno activo por celular/cola · RN04 no se presentó a los 3 min (solo visual) · RN05 límites del plan.

---

## 2. Equipo, reparto y responsabilidades

La asignación de nombres a "Integrante N" es una **propuesta** (orden del README); se puede intercambiar sin afectar el plan.

| Integrante | Persona (propuesta) | Módulos | Fundaciones / núcleo | Horas aprox. |
|---|---|---|---|---|
| 1 | Nick Mayta | **M1** Prioridades · **M2** Predicción de espera | F0 pruebas/CI · F1 scheduler · F2 bus multi-instancia · F5 `emitir_turno`/`llamarSiguiente` · N11 docs/OpenAPI | 158 |
| 2 | Jhan Ramos | **M3** Citas y reservas · **M4** Chatbot WhatsApp | F3 flags por plan · F10 accesibilidad/i18n · N02 historial · N03 hub · N05 horario del local (+ N10 opcional) | 152 |
| 3 | David Romero | **M5** Kiosco offline-first · **M6** Transferencia y balanceo | F7 seguridad base · F9 diseño · N04 expiración RN04 · N06 turno vencido · N09 purga programada | 156 |
| 4 | Henyelrey Garcia | **M7** Analítica y SLA · **M8** Simulador de capacidad | F4 auditoría con actor · F6 observabilidad · F8 datos históricos · N01 auditoría UI · N07 valoración · N08 planes | 160 |

Criterio de reparto: cada persona lleva **un módulo de lógica/algoritmo y otro de integración/datos**, y las fundaciones que su módulo necesita primero.

| Rol transversal | Responsable sugerido | Qué hace |
|---|---|---|
| Líder técnico del repo | Integrante 1 | Guardián de `main`, revisa migraciones y cambios en `backend/src/turnos.ts` |
| Dueño del modelo de datos | Integrante 2 | Una sola persona numera las migraciones para evitar conflictos |
| QA / datos de prueba | Integrante 4 | Mantiene `seed` histórico, escenarios de carga y checklist de aceptación |
| Prototipo/UX | Integrante 3 | Mantiene el Figma alineado con lo implementado |
| Documentación y demo | Rotativo | Informe, manual, video |

**Dependencias entre personas (quién espera a quién):**

```
F0 (I1) ──► todos escriben pruebas
F1 (I1) ──► M2 (I1), M3 (I2) jobs, M6 (I3) evaluador, M7 (I4) alertas/reportes, N04/N09 (I3)
F2 (I1) ──► M5 (I3) panel de dispositivos en vivo, M6 (I3) mapa de carga, M7 (I4) alertas en vivo
F3 (I2) ──► todos ocultan/muestran su módulo por plan
F5 (I1) ──► M1 (I1), M3 (I2), M5 (I3), M6 (I3)   ← la más crítica: cambia emitir_turno() (revisa I2 como dueño del modelo)
M1 (I1) ──► M3 (peso de cita), M5 (botones de prioridad), M6 (conserva clave de orden)
M2 (I1) + M7 (I4) ──► M8 (I4) usa su histórico para calibrar
```

---

## 3. Decisiones de arquitectura transversales

Formato corto: **contexto → decisión → consecuencias**. Si el equipo discrepa, se anota la alternativa elegida aquí.

### ADR-01 · Jobs programados con `pg-boss`
- **Contexto:** hacen falta jobs (purga 90 días, expiración RN04, recordatorios de citas, reentrenamiento, evaluación de reglas y alertas, refresco de vistas, reportes). No hay Redis ni otro servicio; el despliegue es Docker con Postgres.
- **Decisión:** usar **pg-boss** (cola de trabajos sobre PostgreSQL). Un `JobRunner` se registra en `frontend/src/instrumentation.ts` (`register()` solo si `process.env.NEXT_RUNTIME === "nodejs"` y `ENABLE_JOBS !== "false"`). Cada job define `cron`, `singletonKey` (evita ejecución doble con varias instancias) y reintentos con *backoff*.
- **Alternativas descartadas:** `node-cron` (no coordina varias instancias), Vercel Cron (el despliegue es Docker), Redis/BullMQ (infra extra).
- **Consecuencias:** nuevo esquema `pgboss` en la misma BD; los jobs deben ser **idempotentes**; hay que leer la doc de Next 16 sobre `instrumentation`.

| Job | Cron | Dueño | Descripción |
|---|---|---|---|
| `purga-datos-personales` | `0 3 * * *` | I3 | Ejecuta `purgarDatosPersonales(90)` y registra el conteo |
| `expirar-llamados` | cada 15 s | I3 | RN04: LLAMADO ≥ `tiempoAusenciaSeg` ⇒ NO_SE_PRESENTO |
| `citas-recordatorios` | cada 5 min | I2 | T−24 h y T−2 h |
| `citas-no-show` | cada 5 min | I2 | Marca NO_SHOW y bloquea reincidentes |
| `prediccion-reentrenar` | `0 2 * * *` | I1 | Reentrena y evalúa walk-forward |
| `balanceo-evaluar` | cada 30 s | I3 | Evalúa reglas por local con *advisory lock* |
| `analitica-refrescar-mv` | cada 5 min | I4 | `REFRESH MATERIALIZED VIEW CONCURRENTLY` |
| `alertas-evaluar` | cada 1 min | I4 | SLA, anomalías, escalamiento |
| `reportes-programados` | cada 1 min | I4 | Ejecuta los que "toquen" |
| `kiosco-vigilancia` | cada 1 min | I3 | Marca dispositivos sin *heartbeat* |
| `bot-expirar-sesiones` | cada 5 min | I2 | Cierra conversaciones inactivas |

### ADR-02 · Bus de eventos multi-instancia con `LISTEN/NOTIFY`
- **Decisión:** mantener la API `publicar()`/`suscribir()` pero que `publicar` haga `SELECT pg_notify('turnoya_evt', $json)` y cada proceso tenga **una** conexión `LISTEN` que re-emite en su `EventEmitter` local. Payload ≤ 7 500 bytes (límite de `NOTIFY` = 8 000); si excede, se envía solo `{tipo, localId, ref}` y el cliente refresca por REST.
- **Consecuencias:** los SSE funcionan con N instancias; hay que reconectar el `LISTEN` ante caídas; los eventos pasan a ser "al menos una vez" ⇒ los consumidores deben tolerar duplicados.
- **Eventos nuevos (catálogo):** `alerta:nueva|actualizada` (M7) · `kiosco:estado|evento` (M5) · `balanceo:accion` (M6) · `bot:mensaje|handoff` (M4) · `cita:estado` (M3) · `prediccion:modelo` (M2) · `prioridad:config` (M1).

### ADR-03 · Banderas de módulo por plan y por local
- **Decisión:** enum `ModuloCodigo { M1 … M8 }`, tablas `plan_modulo(plan_id, modulo)` y `local_modulo(local_id, modulo, habilitado, config JSONB)`. Helper `moduloActivo(localId, "M3")` (con caché 30 s) que se usa en **API y UI**. `config` guarda parámetros propios del módulo (validados con zod por módulo).
- **Consecuencias:** un módulo desactivado devuelve `403 MODULO_NO_DISPONIBLE` y no aparece en el hub; los límites del plan (RN05) se mantienen.

### ADR-04 · Convenciones de dominio y API
- Código de dominio por módulo en `backend/src/<modulo>/` con `service.ts` (casos de uso), `repo.ts` (Prisma/SQL), `types.ts`, `reglas.ts` (funciones **puras**, sin I/O, 100 % testeables). Esquemas zod en `backend/src/schemas/<modulo>.ts`.
- Rutas bajo `/api/v1/<recurso>`; usar `publico()` o `conRol()`; errores de negocio con `ErrorNegocio(codigo, mensaje, status)` y **prefijo de módulo** (`M3_SLOT_LLENO`).
- Fechas: **UTC en BD (`timestamptz`)**, conversión a zona del local (`America/Lima`) en el borde. Reutilizar `fechaLocalISO`.
- Idempotencia: operaciones expuestas a reintentos (`POST /citas`, `POST /kiosco/sync`, webhook del bot) aceptan `Idempotency-Key` y la guardan en la tabla `idempotencia(clave, ruta, respuesta, expira_at)`.
- Paginación por cursor (`?cursor=&limite=`) en listas que puedan crecer (auditoría, mensajes del bot, eventos del kiosco).
- Nunca `queryRaw` con strings concatenados: solo *tagged template* de Prisma.

### ADR-05 · SQL para lo que debe ser atómico y rápido
Orden de atención, reservas de cupo, deduplicación e idempotencia se resuelven **dentro de la BD** (un `UPDATE … WHERE … RETURNING`, `FOR UPDATE SKIP LOCKED`, `ON CONFLICT`), no con "leer, decidir, escribir" en Node. Es el criterio de diseño de M1, M3, M5.

### ADR-06 · Auditoría con actor
`conAuditoria(session, fn)` abre transacción, ejecuta `SET LOCAL app.usuario_id = '<id>'` y `fn_auditoria()` lo lee con `current_setting('app.usuario_id', true)`. Ver F4.

### ADR-07 · Datos sensibles
Categoría de prioridad "Discapacidad/Gestante" es **dato sensible de salud** (Ley 29733). Se guarda solo el código de categoría, **nunca** se muestra en la TV ni en el ticket, solo lo ven el operador y el admin.

---

### 3.1 Regla de oro: cambios aditivos y reversibles

**El plan parte del código real y no reescribe lo que ya funciona.** Todo lo nuevo va en archivos, tablas y rutas nuevas; lo existente solo se toca donde es
imprescindible, con las siguientes garantías:

1. **Aditivo primero:** tablas nuevas, columnas `NULL`/con `DEFAULT`, enums ampliados, rutas nuevas. Nada de `DROP`, `RENAME` ni cambios de tipo en lo existente.
2. **Apagado = comportamiento actual:** cada módulo nace desactivado (ADR-03). Con el módulo apagado, el sistema se comporta **exactamente** como hoy.
3. **Pruebas de caracterización antes de tocar nada (F0):** se escriben primero pruebas que congelan el comportamiento actual (emitir, avisar, llamar, cancelar, rellamar, reportes, seed). Un PR que toque `backend/src/turnos.ts` o `emitir_turno()` debe mantenerlas en verde.
4. **Compatibilidad de firmas:** `emitir_turno()` conserva su firma original (sobrecarga con parámetros opcionales); `tiempo_estimado()` no se borra.
5. **PR pequeños y revertibles:** un cambio a código existente = un PR de < 500 líneas que se puede revertir con un solo `git revert`.

**Inventario de lo existente que SÍ se toca**

| Existente | Cambio | Tipo | Por qué no altera el comportamiento actual | ¿Imprescindible? |
|---|---|---|---|---|
| `backend/prisma/schema.prisma` (`Turno`, enums `CanalTurno`, `EstadoTurno`) | Columnas nuevas nullable/`DEFAULT`; valores nuevos de enum | Aditivo | Los datos y el seed actuales siguen siendo válidos | Sí (M1, M3, M5, M6) |
| `emitir_turno()` (SQL) | Sobrecarga con parámetros opcionales (categoría, fecha de emisión, origen) | Compatible | Código y seed actuales siguen llamando a la firma antigua | Sí (F5) |
| `llamarSiguiente` (`turnos.ts`) | `findFirst … orderBy emitidoAt` → `siguienteTurno()` | Compatible | Sin M1, `clave_orden = 0` para todos ⇒ desempate por `emitido_at, id` = **FIFO idéntico** | Sí (M1) |
| `obtenerTurnoPorToken` (posición) | `count(emitidoAt < mío)` → `posicion_turno()` | Compatible | Con claves iguales da el mismo resultado | Sí (M1) |
| `revisarAvisos`, `snapshotLocal` | Orden por `clave_orden desc, emitidoAt asc` | Compatible | Igual que arriba | Sí (M1) |
| `tiempoEstimado` | Delega en M2 **solo si M2 está activo**; si no, sigue `tiempo_estimado()` | Compatible | Sin M2, ruta actual intacta | Solo M2 |
| `TRANSICIONES` (`turnos.ts`) | Añade `TRANSFERIDO` | Aditivo | Transiciones existentes no cambian | Solo M6 |
| `webhooks/whatsapp/route.ts` | Rama nueva para mensajes entrantes; la de *acks* no cambia | Aditivo | Mismo contrato para estados de entrega | Solo M4 |
| `whatsapp.ts`, `openwa.ts` | Funciones y plantillas nuevas | Aditivo | No se modifican las existentes | Solo M3, M4, M6, M7 |
| `/panel`, shell del admin, `/l/[slug]` | Bloques/ítems nuevos **condicionados al módulo** | Aditivo | Sin módulo no se renderizan | Según módulo |
| `GET /public/locales/:slug`, `/public/turnos/:token` | Campos **nuevos opcionales** (no se quita ninguno) | Aditivo | Los clientes actuales ignoran campos extra | Según módulo |

**Mejoras de calidad del núcleo — opcionales (cambian comportamiento existente; se pueden posponer o no hacer)**

| Tarea | Qué cambia de lo existente | Cómo hacerla sin riesgo | ¿Necesaria para los módulos? |
|---|---|---|---|
| F2 · bus con `LISTEN/NOTIFY` | Reescribe el interior de `realtime.ts` (misma API `publicar/suscribir`) | Detrás de variable `REALTIME_BUS=pg` (por defecto `memoria`) | **No** si la app corre en **una sola instancia** (los jobs corren en el mismo proceso y el bus en memoria les sirve) |
| F4 · auditoría con actor | Reemplaza `fn_auditoria()` | La nueva conserva las columnas existentes y solo añade campos | No, pero recomendada |
| F7 · seguridad base | Rate limit persistente; falla al arrancar sin secretos | El *fail‑fast* solo con `NODE_ENV=production`; el rate limit nuevo detrás de bandera | No |
| N04 · expiración RN04 automática | Nueva conducta: LLAMADO → NO_SE_PRESENTO solo | Opt‑in: `local.tiempo_ausencia_seg = NULL` ⇒ desactivado | No |
| N09 · purga de datos programada | Ejecuta la función que ya existe | Opt‑in con `ENABLE_JOBS` | No (pero cumple RNF08/Ley 29733) |
| N05 · horario del local / cola cerrada | Respuesta pública con `abierto` | Sin horarios definidos ⇒ siempre abierto como hoy | Solo M3 |
| F9 · colores y tokens | Visual | Opcional | No |

**Conclusión práctica:** para que los 8 módulos funcionen, lo existente se toca solo en **F5 + los puntos de `turnos.ts` y del webhook de la tabla anterior**.
Todo lo demás es código nuevo. Las mejoras opcionales pueden dejarse fuera sin afectar a los módulos; si el equipo decide no tocar el núcleo más de lo estrictamente necesario,
se omiten F2, F4, F7, N04, N09 y F9 y se ajusta el cronograma (≈ −49 h en total: F2 12 + F4 12 + F7 10 + N04 6 + N09 3 + F9 6).

---

## 4. Fundaciones (trabajo previo común)

Deben estar listas **antes** de que los módulos dependan de ellas. **Las marcadas como opcionales en §3.1 (F2, F4, F7, F9) pueden omitirse** si el equipo prefiere no tocar el núcleo más allá de lo imprescindible. Estimación total ≈ 114 h.

### F0 · Pruebas, calidad y CI — *Integrante 1 · 16 h*
- [ ] Añadir **Vitest** (`vitest`, `@vitest/coverage-v8`) con `vitest.config.ts` (alias `@/` → `src/`). Scripts: `test`, `test:watch`, `test:int`, `coverage`.
- [ ] Capa de integración: BD de pruebas con **Testcontainers** (`@testcontainers/postgresql`) o un servicio `db_test` en `docker-compose.test.yml` (puerto 5433). Cada archivo de test crea un *schema* aleatorio y corre `prisma migrate deploy`.
- [ ] Utilidades `backend/tests/helpers/`: `crearLocal()`, `crearCola()`, `crearTurnos(n)`, `reloj falso` (`vi.useFakeTimers`), `semilla PRNG`.
- [ ] **Playwright** para e2e (`backend/tests/e2e/`), proyectos `cliente-movil` (390×844) y `staff-escritorio` (1280×800).
- [ ] `.env.example` completo (todas las variables de §10.3) y `README` actualizado.
- [ ] ESLint: reglas `no-floating-promises`, `eqeqeq`; `tsc --noEmit` en CI.
- [ ] GitHub Actions `ci.yml`: instalar → `prisma generate` → typecheck → lint → test → build (cache npm).
- **Hecho cuando:** `npm test` corre 1 prueba real de `transicionValida` y 1 de integración de `emitir_turno` con 50 emisiones concurrentes sin duplicados.

### F1 · Scheduler de jobs (ADR-01) — *Integrante 1 · 12 h*
- [ ] Instalar `pg-boss`; `src/server/jobs/runner.ts` (singleton por proceso), `src/server/jobs/registro.ts` (tabla de jobs de ADR-01), `frontend/src/instrumentation.ts`.
- [ ] Helper `definirJob({ nombre, cron, singleton, reintentos, handler })` con log estructurado (`job`, `duracion_ms`, `resultado`).
- [ ] Endpoint de salud ampliado `/api/health` con estado de `pg-boss` y último latido de cada job.
- [ ] Panel mínimo en super-admin `/admin/jobs` (nombre, última corrida, resultado, próxima) — reutiliza `Table`.
- **Hecho cuando:** un job de prueba corre cada minuto en una sola instancia aunque se levanten dos procesos.

### F2 · Bus de eventos con `LISTEN/NOTIFY` (ADR-02) — *Integrante 1 · 12 h*
- [ ] Reescribir `backend/src/realtime.ts` manteniendo `publicar` y `suscribir`; conexión `pg` dedicada con reconexión exponencial.
- [ ] Tipar el catálogo de eventos nuevos en `EventoRealtime`.
- [ ] Prueba de integración con dos "procesos" (dos instancias del módulo) comprobando que un evento publicado en A llega a un suscriptor de B.
- **Hecho cuando:** dos `next start` en puertos distintos comparten la TV en vivo.

### F3 · Banderas de módulo por plan y local (ADR-03) — *Integrante 2 · 8 h*
- [ ] Migración: enum `ModuloCodigo`, `plan_modulo`, `local_modulo`; seed según §7.
- [ ] `backend/src/modulos.ts`: `moduloActivo`, `exigirModulo(localId, codigo)` (lanza `ErrorNegocio("MODULO_NO_DISPONIBLE", …, 403)`), hook `useModulos()` en cliente.
- [ ] UI `/admin/modulos` (hub) y `/admin/modulos/[codigo]` con el interruptor del local.
- **Hecho cuando:** un local en plan GRATIS no ve M1…M8 y la API responde 403.

### F4 · Auditoría con actor (ADR-06) — *Integrante 4 · 12 h*
- [ ] Migración: reemplazar `fn_auditoria()` para leer `app.usuario_id`; añadir triggers a `cola`, `ventanilla`, `local`, `categoria_prioridad`, `regla_balanceo`, `regla_alerta`, `sla_cola`, `local_modulo`.
- [ ] Helper `conAuditoria(session, tx => …)` y su uso en TODOS los handlers que mutan (`PATCH /turnos/:id/estado`, `llamar-siguiente`, CRUD de colas/ventanillas/usuarios).
- [ ] Columnas nuevas: `auditoria.ip`, `auditoria.request_id`, `auditoria.accion_humana` (texto legible, p. ej. "Llamó al turno A-021").
- [ ] Retención configurable (por defecto 365 días) en job `purga-auditoria`.
- **Hecho cuando:** cambiar el estado de un turno deja una fila con `usuario_id`, `ip` y `request_id`.

### F5 · Extender `emitir_turno()` y `llamarSiguiente()` — *Integrante 1 (revisa Integrante 2) · 14 h* (**la más crítica**)
Ver detalle en `docs/modulos/M1` y `M3`. Cambios:
- [ ] Nueva firma `emitir_turno(p_cola, p_cliente, p_canal, p_token, p_fecha, p_categoria int DEFAULT NULL, p_emitido timestamptz DEFAULT now(), p_origen jsonb DEFAULT NULL)`; mantener una **sobrecarga con la firma antigua** para no romper el seed ni código existente.
- [ ] Columnas en `turno`: `categoria_id`, `clave_orden double precision`, `cita_id`, `origen_dispositivo_id`, `codigo_provisional`, `transferido_de_turno_id`, `sucesor_id`, `delante_emision int`, `ventanillas_activas_emision int`.
- [ ] Enums ampliados: `CanalTurno += WHATSAPP, KIOSCO, CITA`; `EstadoTurno += TRANSFERIDO`; actualizar `TRANSICIONES`.
- [ ] Índice parcial `ix_turno_espera (cola_id, clave_orden DESC) WHERE estado IN ('EMITIDO','AVISADO')`.
- [ ] Extraer la selección del siguiente a **una función única** `siguienteTurno(tx, {localId, colaId, ventanillaId})` (hoy FIFO; M1 la reemplaza) y la posición a `posicionDe(turno)`.
- **Hecho cuando:** toda la suite F0 pasa con la firma nueva y con la antigua, y `llamarSiguiente` usa `clave_orden`.

### F6 · Observabilidad — *Integrante 4 · 8 h*
- [ ] Logger JSON único (`backend/src/log.ts`) con `request_id`, `local_id`, `usuario_id`, `modulo`.
- [ ] Métricas internas (contadores/histogramas en memoria expuestos en `/api/metrics` solo para SUPER_ADMIN o con token): turnos emitidos, latencia de `llamarSiguiente`, mensajes del bot, eventos de kiosco, ejecuciones de reglas, errores por código.
- [ ] Correlación: `x-request-id` entrante se propaga a jobs y notificaciones.

### F7 · Endurecimiento de seguridad base — *Integrante 3 · 10 h*
- [ ] **Fallar al arrancar** en producción si `JWT_SECRET` o `DATA_ENCRYPTION_KEY` no están definidos o usan el valor por defecto (B3).
- [ ] Rate limit persistente (tabla `rate_limit(clave, ventana, contador)` con `INSERT … ON CONFLICT DO UPDATE`) para `POST /public/turnos`, `POST /auth/login`, webhook del bot, `POST /kiosco/*`.
- [ ] Límite de intentos de login (5 fallos ⇒ bloqueo 15 min por correo+IP).
- [ ] Cabeceras: añadir CSP (`default-src 'self'`; imágenes de `logoUrl` permitidas), `Permissions-Policy`, HSTS en producción.
- [ ] Revisión OWASP ASVS nivel 1 de los endpoints nuevos (checklist en §9).

### F8 · Datos de prueba históricos — *Integrante 4 · 10 h*
- [ ] `backend/prisma/seed-historico.ts`: genera **60 días** de turnos con llegadas Poisson no homogéneas (curva por hora y día de semana), tiempos de servicio log-normales por cola, 8 % no-show, 5 % cancelados, categorías de prioridad (6 %/4 %/3 %), valoraciones. Semilla fija para reproducibilidad.
- [ ] Script `npm run db:seed:historico -- --dias 60 --local policlinico-san-roman`.
- [ ] Lo usan M2 (entrenar), M7 (heatmap/SLA), M8 (calibrar) y las pruebas de carga.

### F9 · Alineación de diseño — *Integrante 3 · 6 h*
- [ ] Decidir color de marca (teal `#0f766e` del código vs esmeralda `#059669` del Figma) y unificar en tokens de Tailwind/Figma.
- [ ] Extraer a `frontend/src/components/app/` los componentes que el prototipo ya definió: `NavItem`, `KpiCard`, `Chip`, `Tabs` de módulo, `DataTable`, `Toast`.
- [ ] Nombres de planes y precios del Figma ← seed (GRATIS/EMPRENDE/PRO).

### F10 · Accesibilidad y localización — *Integrante 2 · 6 h*
- [ ] `lang="es-PE"`, formatos con `Intl` (hora 24 h, moneda `PEN`).
- [ ] Contraste AA en tokens; foco visible; objetivos táctiles ≥ 44 px (obligatorio en kiosco y móvil).
- [ ] Textos de la TV legibles a 5 m (≥ 64 px el código).

---

## 5. Brechas del núcleo a cerrar

Pantallas que ya están en el prototipo (o necesidades detectadas) y **no existen** en la app.

| ID | Tarea | Resp. | Horas | Detalle |
|---|---|---|---|---|
| N01 | Pantalla `/admin/auditoria` | I4 | 6 | Tabla con filtros (rango, usuario, acción, entidad), búsqueda por `request_id`, exportación CSV, detalle del `datos_json` con *diff* antes/después |
| N02 | Historial del operador `/panel/historial` | I2 | 6 | `GET /api/v1/turnos?ventanillaId&fecha&estado&cursor`; KPIs del día; reutilizar `reporteEspera` filtrado |
| N03 | Hub `/admin/modulos` | I2 (con F3) | 4 | Tarjetas con integrante, complejidad y estado del módulo |
| N04 | Expiración automática de llamados (RN04) | I3 | 6 | Columna `local.tiempo_ausencia_seg` (def. 180) + job `expirar-llamados` (cada 15 s) que pasa LLAMADO→NO_SE_PRESENTO, publica evento y notifica por WhatsApp "tu turno venció". Mostrar cuenta regresiva en el panel con el mismo valor |
| N05 | Horario del local y "cola cerrada" | I2 | 8 | Tabla `horario_local(local_id, dia_semana, apertura, cierre, activo)` y `cola.abre_en/cierra_en` opcionales; `GET /public/locales/:slug` devuelve `abierto`, `proximaApertura`; UI cliente "Esta cola está cerrada" (Figma N6) |
| N06 | Pantalla "turno vencido" en `/t/[token]` | I3 | 3 | Estado NO_SE_PRESENTO muestra la tarjeta de Figma N7 con botón "Tomar un nuevo turno" |
| N07 | Valoración del servicio | I4 | 8 | Tabla `valoracion(turno_id unique, estrellas 1-5, comentario ≤ 280, created_at)`; `POST /public/turnos/:token/valoracion` (solo ATENDIDO, 1 vez); UI "Gracias" (Figma C5) |
| N08 | Edición de planes por el super admin | I4 | 4 | CRUD básico de `plan` + matriz `plan_modulo` |
| N09 | Job de purga de datos personales | I3 | 3 | Programa `purgarDatosPersonales(90)` (B4), registra conteo en auditoría |
| N10 | Recuperar contraseña | opcional | 10 | Tabla `password_reset(token_hash, usuario_id, expira_at, usado_at)`, correo por SMTP (`nodemailer`), pantalla `/login/recuperar`. Si no hay SMTP, el admin del local restablece manualmente |
| N11 | `.env.example`, `docs/ARQUITECTURA.md`, `docs/API.md` (OpenAPI) | I1 | 8 | Generar OpenAPI desde los esquemas zod (`zod-to-openapi`) |

---

## 6. Los 8 módulos avanzados

Resumen; el detalle técnico completo está en cada archivo.

| # | Módulo | Integrante | Archivo | Núcleo técnico | Horas |
|---|---|---|---|---|---|
| M1 | Motor de prioridades con aging | 1 | [`modulos/M1-prioridades.md`](modulos/M1-prioridades.md) | Clave de orden estable e indexada, anti-inanición, `FOR UPDATE SKIP LOCKED` | 40 |
| M2 | Predicción de espera | 1 | [`modulos/M2-prediccion-espera.md`](modulos/M2-prediccion-espera.md) | EMA + estacionalidad, intervalos empíricos, validación walk-forward | 56 |
| M3 | Citas y reservas con check-in QR | 2 | [`modulos/M3-citas-reservas.md`](modulos/M3-citas-reservas.md) | Cupos atómicos, ventana de check-in, jobs, `.ics` | 64 |
| M4 | Chatbot de WhatsApp | 2 | [`modulos/M4-chatbot-whatsapp.md`](modulos/M4-chatbot-whatsapp.md) | FSM pura, webhook con HMAC, idempotencia, *handoff* | 56 |
| M5 | Kiosco offline-first | 3 | [`modulos/M5-kiosco-offline.md`](modulos/M5-kiosco-offline.md) | PWA + IndexedDB outbox, sync idempotente, reloj | 72 |
| M6 | Transferencia y balanceo | 3 | [`modulos/M6-transferencia-balanceo.md`](modulos/M6-transferencia-balanceo.md) | Motor de reglas, histéresis, *dry-run*, antigüedad conservada | 56 |
| M7 | Analítica y SLA con alertas | 4 | [`modulos/M7-analitica-sla.md`](modulos/M7-analitica-sla.md) | Percentiles SQL, MV, MAD, deduplicación y escalamiento | 60 |
| M8 | Simulador de capacidad | 4 | [`modulos/M8-simulador-capacidad.md`](modulos/M8-simulador-capacidad.md) | Erlang C estable, DES, Monte Carlo, Web Worker | 52 |

### 6.1 Interacciones entre módulos (contrato)

| Quién | Usa | Contrato |
|---|---|---|
| M3 | M1 | La cita crea el turno con la categoría `CITA` (peso base configurable); entra en `clave_orden` como cualquier otro |
| M3 | M4 | El bot permite agendar y responder "1 confirmar / 2 cancelar" a los recordatorios |
| M4 | M1 | El bot pregunta categoría si el local tiene M1 activo |
| M5 | M1 | El kiosco muestra botones de prioridad si M1 está activo |
| M6 | M1 | La transferencia conserva `clave_orden` y `emitido_at` |
| M6 | M7 | Las reglas pueden usar métricas de SLA y lanzar alertas |
| M2 | M7 | M7 muestra precisión del modelo; ambos leen `mv_turno_franja` |
| M8 | M2, M7 | Calibra λ y μ con el histórico; compara con el real |
| M7 | M5 | Alerta `KIOSCO_OFFLINE` |

### 6.2 Orden de construcción recomendado
1. Fundaciones F0–F5 (semanas 1–2).
2. Núcleo de cada módulo (datos + lógica pura + pruebas), sin UI (semanas 2–3).
3. API y UI de cada módulo (semanas 3–4).
4. Integraciones cruzadas §6.1 y e2e (semana 5).
5. Endurecimiento, carga, documentación y demo (semana 6).

---

## 7. Matriz de planes y módulos

| Módulo | GRATIS | EMPRENDE | PRO | Nota |
|---|---|---|---|---|
| M1 Prioridades | — | ✔ (hasta 4 categorías) | ✔ (ilimitadas, α por local) | |
| M2 Predicción | baseline (RN02) | baseline | ✔ modelos EMA/estacional | El baseline siempre existe |
| M3 Citas | — | ✔ (1 cola) | ✔ (todas) | Los recordatorios consumen avisos WA |
| M4 Chatbot | — | ✔ | ✔ | Cada mensaje saliente descuenta de `maxAvisosWhatsapp` solo si es plantilla; las respuestas dentro de sesión no |
| M5 Kiosco | — | — | ✔ (hasta 3 dispositivos) | |
| M6 Balanceo | — | transferencia manual | ✔ reglas automáticas | |
| M7 Analítica/SLA | dashboard actual | dashboard actual | ✔ completo | Hoy `reportes` solo en PRO |
| M8 Simulador | — | — | ✔ | |

Implementación: `plan_modulo` + `local_modulo` (ADR-03). Cambiar la matriz es solo un *seed*.

---

## 8. Estrategia de pruebas y calidad

### 8.1 Pirámide
| Nivel | Herramienta | Qué cubre | Meta |
|---|---|---|---|
| Unitarias (lógica pura) | Vitest | `reglas.ts` de cada módulo: puntaje, FSM del bot, evaluador de reglas, Erlang C, detección de anomalías | ≥ 90 % de líneas en `reglas.ts` |
| Propiedades | `fast-check` | No-inanición (M1), conservación de antigüedad (M6), orden estable, sin fuga de datos en walk-forward (M2), idempotencia (M5) | ≥ 3 propiedades por módulo |
| Integración (BD real) | Vitest + Testcontainers | SQL: `siguiente_turno`, reserva de cupo, `emitir_turno` con categoría, vistas, triggers de auditoría | todo SQL nuevo tiene prueba |
| Concurrencia | Vitest + `Promise.all` | 2 ventanillas llamando a la vez; 50 reservas simultáneas; 100 sync del mismo lote | 0 duplicados en 200 corridas |
| API (contratos) | Vitest + `fetch` contra `next start` | Códigos de estado, errores, permisos por rol y por plan | cada endpoint nuevo: 1 camino feliz + 3 errores |
| E2E | Playwright | Flujos del cliente, operador, admin, kiosco offline, bot (simulado) | ≥ 12 escenarios (§8.3) |
| Carga | k6 | 200 clientes emitiendo en 60 s; SSE con 300 conexiones | p95 emisión < 400 ms; 0 errores 5xx |
| Accesibilidad | axe-core en Playwright | Pantallas públicas | 0 violaciones graves |
| Seguridad | Checklist §9 + `npm audit` | Autorización, validación, secretos | sin hallazgos altos |

### 8.2 Datos de prueba
`seed` (demo) + `seed-historico` (F8) + factorías de pruebas. Cada test crea su propio local para no depender del orden.

### 8.3 Escenarios E2E mínimos
1. Cliente toma turno por QR, ve posición y cancela.
2. Operador llama siguiente, rellama, marca no se presentó (y expira solo, N04).
3. TV muestra el llamado en < 1 s.
4. Prioridad: gestante pasa delante de general; general antiguo no queda relegado (M1).
5. Reservar cita, check-in dentro de ventana, turno creado con prioridad (M3).
6. Cita: segunda reserva en slot lleno falla con `M3_SLOT_LLENO`.
7. Bot: tomar turno, consultar posición, cancelar (simulando webhook) (M4).
8. Kiosco: emitir con red cortada, reconectar, sin duplicados (M5).
9. Transferencia manual conserva antigüedad (M6).
10. Regla de balanceo en modo simulación registra acción sin ejecutar; en modo real mueve operador (M6).
11. Alerta SLA se abre, escala y se resuelve (M7).
12. Simulador: c=3 incumple, c=4 cumple (M8).

### 8.4 Definition of Done por tarea
Código + pruebas + migración reversible/documentada + permisos y plan verificados + log/auditoría + entrada en `docs/` + captura o video si tiene UI + revisión de otra persona.

---

## 9. Seguridad, privacidad y cumplimiento

### 9.1 Ley N.° 29733 (Perú) y datos personales
- Consentimiento explícito para WhatsApp (ya existe); extender a **kiosco** (texto en pantalla) y **bot** (pregunta SÍ/NO).
- Datos sensibles (ADR-07): categoría de prioridad, mensajes del bot. Cifrar `contexto` y `texto` del bot si contienen teléfono/nombre; no registrarlos en logs.
- Retención: teléfonos/nombres 90 días (N09); mensajes del bot 30 días; auditoría 365 días; valoraciones sin PII.
- Derechos ARCO: endpoint admin `DELETE /api/v1/clientes/:id/datos` (anonimiza) y procedimiento documentado.

### 9.2 Autorización
- Matriz de permisos por endpoint (rol × módulo × plan) en `docs/PERMISOS.md`. Regla general: `OPERADOR` opera, `ADMIN_LOCAL` configura, `SUPER_ADMIN` administra locales y planes.
- **Aislamiento multi-tenant:** toda consulta de módulos filtra por `localId` de la sesión; test automático que intenta leer datos de otro local en cada endpoint.
- Dispositivos de kiosco: token propio (hash SHA-256 en BD), alcance limitado a emitir/sincronizar.

### 9.3 Checklist OWASP ASVS (nivel 1) a pasar por módulo
- [ ] Validación de entrada con zod en todos los bodies/queries.
- [ ] Autorización en cada handler; sin IDOR (usar `localId` de sesión).
- [ ] Sin SQL concatenado; `$queryRaw` solo con *template tags*.
- [ ] Rate limit en endpoints públicos y de bots.
- [ ] Firma HMAC verificada con comparación en tiempo constante y ventana anti-replay (5 min).
- [ ] Secretos solo por variables de entorno; ninguno en el repo/Figma.
- [ ] Errores sin trazas ni datos personales en la respuesta.
- [ ] Cabeceras de seguridad y cookies `httpOnly`, `sameSite=lax`, `secure` en HTTPS.

### 9.4 WhatsApp no oficial (OpenWA)
Riesgo de bloqueo del número: usar número dedicado, plantillas con baja frecuencia, solo a quien consintió; mantener `meta` como camino oficial. El bot debe respetar un **máximo de mensajes salientes por minuto** y rechazar conversaciones con números no consentidos.

---

## 10. DevOps, CI/CD y operación

### 10.1 Entornos
| Entorno | Uso | Datos |
|---|---|---|
| local | desarrollo (`npm run setup` + `npm run dev`) | seed demo |
| test (CI) | GitHub Actions con Postgres de servicio | efímeros |
| demo | Docker en un VPS/PC del laboratorio | seed demo + histórico |

### 10.2 Migraciones
- Convención: `YYYYMMDDHHMMSS_modulo_descripcion`. Una migración por módulo y por cambio lógico; el **dueño del modelo de datos (I2)** valida conflictos antes de fusionar.
- Toda migración con SQL a mano (funciones, MV, índices parciales) va en archivos `.sql` revisados; probar `migrate reset` + seed en CI.
- Cambios compatibles hacia atrás (añadir columnas con `DEFAULT`, mantener sobrecarga de `emitir_turno`).

### 10.3 Variables de entorno (nuevas y existentes)
| Variable | Módulo | Descripción |
|---|---|---|
| `DATABASE_URL`, `JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL`, `WHATSAPP_*`, `OPENWA_*`, `SEED_ON_START` | núcleo | existentes |
| `ENABLE_JOBS` | F1 | `true` en una sola réplica o en todas (pg-boss coordina) |
| `PGBOSS_SCHEMA` | F1 | esquema de pg-boss (def. `pgboss`) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | M7, N10 | correo para alertas/reportes |
| `REPORTES_DIR` | M7 | carpeta de PDFs (volumen Docker) |
| `KIOSCO_PAIRING_TTL_MIN` | M5 | validez del código de emparejamiento (def. 10) |
| `BOT_MAX_MSG_MIN` | M4 | límite de mensajes por teléfono y minuto (def. 20) |
| `DB_TEST_URL` | F0 | BD de pruebas |

### 10.4 Docker
- `docker-compose.yml`: añadir volumen `turnoya_reportes`, servicio opcional `mailpit` (SMTP de pruebas) bajo el perfil `dev`.
- El `Dockerfile` standalone debe copiar la carpeta de fuentes del PDF (M7) y las migraciones.

### 10.5 Respaldo y recuperación
`pg_dump` diario (job externo o `cron` del host), retención 7 días; prueba de restauración documentada.

### 10.6 Observabilidad en demo
`/api/health`, `/admin/jobs`, `/api/metrics`, logs JSON a stdout (`docker compose logs -f app`).

---

## 11. Cronograma y estimación

Supuesto: **6 semanas desde el 13/10/2026** (ajustar a la fecha real de entrega). Horas ≈ 156 por persona = ≈ 26 h/semana.

| Semana | Foco | Entregables verificables |
|---|---|---|
| S1 (13–19/10) | F0, F1, F3, F5 (firma de `emitir_turno`), diseño de datos de cada módulo, Figma restante | CI verde; `emitir_turno` nuevo; migraciones de los 8 módulos revisadas por el dueño del modelo |
| S2 (20–26/10) | F2, F4, F7, F8; lógica pura + pruebas de M1, M2, M3, M4, M6, M7, M8 | `reglas.ts` de cada módulo con ≥ 90 % de cobertura; histórico sembrado |
| S3 (27/10–2/11) | APIs y jobs de todos los módulos; M5 (PWA base + outbox) | Todos los endpoints con pruebas de contrato; jobs corriendo |
| S4 (3–9/11) | UI de los módulos (según Figma), N01–N09 | Recorrido completo desde el hub; e2e 1–6 |
| S5 (10–16/11) | Integraciones §6.1, e2e 7–12, carga con k6, endurecimiento | Informe de rendimiento; 0 hallazgos altos de seguridad |
| S6 (17–23/11) | Congelamiento, documentación, video, ensayo de demo, correcciones | Release `v1.0`; manual; presentación |

**Hitos de control (semanales):** viernes — demo interna de 15 min por persona; lunes — replanificación.
**Buffer:** 15 % de la semana 6 reservado para imprevistos; si un módulo se atrasa, el orden de recorte es **M8 → M5 → M7 (reportes programados) → M4 (handoff)**, nunca M1/M3 (impactan el núcleo).

### 11.1 Resumen de horas
| Integrante | Módulos | Fundaciones y núcleo asignados | Total |
|---|---|---|---|
| 1 · Nick | M1 40 + M2 56 = 96 | F0 16 + F1 12 + F2 12 + F5 14 + N11 8 = 62 | 158 |
| 2 · Jhan | M3 64 + M4 56 = 120 | F3 8 + F10 6 + N02 6 + N03 4 + N05 8 = 32 (+ N10 opcional 10) | 152 |
| 3 · David | M5 72 + M6 56 = 128 | F7 10 + F9 6 + N04 6 + N06 3 + N09 3 = 28 | 156 |
| 4 · Henyelrey | M7 60 + M8 52 = 112 | F4 12 + F6 8 + F8 10 + N01 6 + N07 8 + N08 4 = 48 | 160 |
| **Total** | **456** | **170** | **626** |

> Diferencia máxima entre personas: 8 h (5 %). Si en S1 se detecta desequilibrio, mover N06 (3 h), N08 (4 h) o N10 (10 h).

---|---|---|---|
| 1 | 40 + 56 = 96 | F0 16 + F1 12 + F2 12 = 40 | 136 |
| 2 | 64 + 56 = 120 | F3 8 + F5 14 − (compensa con N02 6, N03 4, N05 8) | ≈ 134 + |
| 3 | 72 + 56 = 128 | N04 6 + N06 3 + N09 3 + F9 6 | ≈ 146 |
| 4 | 60 + 52 = 112 | F4 12 + F8 10 + N01 6 + N07 8 + N08 4 | ≈ 152 |

> Si las cifras de los integrantes 3 y 4 resultan altas, mover N06 y N08 al integrante 1 (le quedan ≈ 130 h). Revisar en la reunión de S1.

---

## 12. Prototipo Figma: estado y pendientes

Archivo `TurnoYa - Prototipo` (`fileKey jMAVFaO6CVSeD4jTwMCxSL`). Convenciones: nodos `Nav/<etiqueta>`, botones `Boton/<texto>`, pestañas `Tab/<texto>`; un destino NAVIGATE no puede ser el mismo marco de origen; los *overlays* no admiten fondo oscuro por la API.

**Hecho (con navegación e interacción):** Componentes · Cliente móvil (C0–C5 + diálogo de cancelación) · Operación (login, panel en 4 estados, TV ×2, aviso) · Administración (dashboard, colas, ventanillas, usuarios, reportes, pantalla y QR, super admin, modales) · Núcleo (landing, historial operador, local y WhatsApp, auditoría, hub de módulos, ticket 80 mm, cola cerrada, turno vencido, modales).

**Pendiente por límite del MCP de Figma (plan Starter):** las secciones por integrante (M1–M8) — ver pantallas previstas en cada archivo de módulo — y el cableado de las tarjetas `Modulo/M1…M8` del hub. Además: corregir planes/precios (B13) y color de marca (B12).

**Pantallas totales previstas por módulo (para dibujar):**
M1: 3 · M2: 3 · M3: 3 · M4: 2 · M5: 4 · M6: 2 · M7: 3 · M8: 2 = **22 pantallas**.

---

## 13. Entregables académicos

| Entregable | Contenido | Responsable |
|---|---|---|
| Informe técnico | Problema, alcance, arquitectura, modelo de datos, cada módulo (diseño, algoritmo, pruebas, resultados), conclusiones | Rotativo, 1 capítulo por integrante (sus 2 módulos) |
| Manual de usuario | Cliente, operador, admin, super admin, kiosco | I3 |
| Manual de instalación | `docs/INSTALACION.md` (Docker, variables, OpenWA) | I1 |
| Presentación + demo | 15 min: historia del usuario + 4 mini-demos (una por integrante) | Todos |
| Video de 5 min | Recorrido por el prototipo y la app | I4 |
| Evidencia de pruebas | Reporte de cobertura, k6, e2e, axe | I4 |

**Guion de demo sugerido (15 min):** (1) problema y arquitectura 2 min · (2) cliente + TV + operador en tiempo real 3 min · (3) I1: prioridades y predicción 2 min · (4) I2: cita + bot 3 min · (5) I3: kiosco offline y balanceo 3 min · (6) I4: SLA/alerta y simulador 2 min.

---

## 14. Flujo de trabajo del equipo

- **Ramas:** `main` protegida; `feat/m1-prioridades`, `feat/f1-scheduler`, `fix/…`. Una rama por tarea grande.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) en español (`feat(m1): …`, `fix(core): …`). La autoría de cada commit es de la persona que lo hace.
- **PR:** plantilla con *qué cambia*, *cómo probarlo*, *capturas*, checklist DoD §8.4. **Mínimo 1 revisión** de otra persona; el dueño del modelo de datos revisa toda migración; el líder técnico revisa cambios en `backend/src/turnos.ts`.
- **Tamaño:** PRs de < 500 líneas de diff (sin generados); si es mayor, dividir.
- **Migraciones:** nunca editar una ya fusionada; crear otra.
- **Reuniones:** daily async (3 líneas en el chat), reunión de 30 min lunes y viernes.
- **Tablero:** columnas `Por hacer · En curso · En revisión · Hecho`, una tarjeta por `Mx-Tnn`.

---

## 15. Riesgos globales

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | Cambiar `emitir_turno()`/`llamarSiguiente` rompe el núcleo | Media | Alto | F0 antes que F5; sobrecarga con firma antigua; pruebas de concurrencia |
| R2 | Conflictos de migraciones entre 4 personas | Alta | Medio | Dueño del modelo de datos; migraciones pequeñas; rebase frecuente |
| R3 | Número de OpenWA bloqueado en la demo | Media | Alto | Proveedor `mock` de respaldo; número dedicado "calentado"; video de la demo grabado |
| R4 | M5 (offline) y M8 (simulación) son los más largos | Media | Medio | Empezar en S1–S2 con lógica pura; orden de recorte §11 |
| R5 | Carga de trabajo desigual | Media | Medio | Revisión de horas en S1 y S3; mover tareas (§11.1) |
| R6 | Jobs duplicados con varias instancias | Baja | Alto | pg-boss `singletonKey` + advisory locks + idempotencia |
| R7 | Límites del MCP de Figma retrasan el prototipo | Alta | Bajo | Los archivos de módulo describen cada pantalla; se puede maquetar directamente en la app |
| R8 | Datos sensibles expuestos (prioridad/discapacidad) | Baja | Alto | ADR-07; prueba que la TV y el ticket nunca muestran la categoría |
| R9 | Desfase de reloj entre kiosco y servidor | Media | Medio | Corrección con *heartbeat*; orden por reloj corregido y *clamp* (M5) |
| R10 | Next 16 cambia APIs respecto a lo conocido | Media | Medio | Leer `node_modules/next/dist/docs/` antes de usar `instrumentation`, caché, rutas |

---

## 16. Apéndices

### A. Glosario
**Aging:** aumento del puntaje por tiempo de espera. **Clave de orden:** valor numérico persistido que define el orden de atención. **DES:** simulación de eventos discretos. **ERLANG C:** fórmula M/M/c de probabilidad de espera. **FSM:** máquina de estados finitos. **Handoff:** traspaso de un chat del bot a una persona. **Histéresis:** umbrales distintos para activar y desactivar una regla. **MAD:** desviación absoluta mediana. **Outbox:** cola local de eventos pendientes de enviar. **SLA:** objetivo de nivel de servicio (p. ej. 90 % de turnos con espera ≤ 15 min).

### B. Matriz de trazabilidad (requisitos nuevos → módulo)
| Necesidad | Módulo | Requisitos |
|---|---|---|
| Atención preferente sin inanición | M1 | RF-M1-01…09, RN-M1-01…07 |
| Estimación con rango de confianza | M2 | RF-M2-01…08, RN-M2-01…06 |
| Agendar y llegar con QR | M3 | RF-M3-01…12, RN-M3-01…10 |
| Atención por WhatsApp | M4 | RF-M4-01…11, RN-M4-01…08 |
| Sacar turno sin conexión | M5 | RF-M5-01…12, RN-M5-01…09 |
| Evitar colas desbalanceadas | M6 | RF-M6-01…10, RN-M6-01…09 |
| Medir calidad y reaccionar | M7 | RF-M7-01…13, RN-M7-01…09 |
| Dimensionar ventanillas | M8 | RF-M8-01…09, RN-M8-01…06 |

### C. Checklist de revisión de PR
- [ ] ¿Hay pruebas nuevas y pasan en CI?
- [ ] ¿La migración es segura y está documentada?
- [ ] ¿Se verifica plan/módulo y rol en la API?
- [ ] ¿Todo query filtra por `localId`?
- [ ] ¿Se registra auditoría y log con `request_id`?
- [ ] ¿Se manejan estados vacío / carga / error en la UI?
- [ ] ¿Se actualizó `docs/` y el Figma (si cambió la UI)?

### D. Fuentes internas
`README.md` (trazabilidad y API), `backend/prisma/schema.prisma`, `backend/prisma/migrations/*`, `backend/src/turnos.ts`, `backend/src/realtime.ts`, `backend/src/whatsapp.ts`, `backend/src/api.ts`, `AGENTS.md` (aviso de Next 16).
