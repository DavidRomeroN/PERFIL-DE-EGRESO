# TurnoYa — Todo lo que falta por hacer (v2)

> Estado verificado al **12/10/2026 (noche)** sobre el commit `b4f593d` ("arreglo de modulos", `origin/main`).
> Verificación hecha: migraciones aplicadas, `typecheck` y `lint` limpios, `npm test` (8 pruebas) en verde, servidor levantado, páginas y rutas nuevas con respuesta 200, y pruebas manuales contra la API.
> El *cómo* detallado de cada módulo está en [`PLAN_INTEGRAL.md`](PLAN_INTEGRAL.md) y [`modulos/M1…M8`](modulos/). Aquí: **qué existe, qué falta y qué corregir**, con rutas de archivo.
>
> **Versión anterior (commit `00f25ea`):** 4 módulos parciales y 4 inexistentes. **Ahora:** los 8 módulos tienen un primer esqueleto funcional, pero la mayoría es una versión mínima (en memoria, sin concurrencia segura, sin pruebas) que **no cumple todavía** los requisitos de los documentos de módulo.

## Índice
0. [Antes de empezar](#0-antes-de-empezar)
1. [Resumen del estado](#1-resumen-del-estado)
2. [Correcciones: lo que se arregló y lo que sigue pendiente (Ola 0)](#2-correcciones-lo-que-se-arregló-y-lo-que-sigue-pendiente-ola-0)
3. [Defectos nuevos encontrados en el último commit](#3-defectos-nuevos-encontrados-en-el-último-commit)
4. [Fundaciones y núcleo](#4-fundaciones-y-núcleo)
5. [Módulos: qué existe y qué falta](#5-módulos-qué-existe-y-qué-falta)
6. [Prototipo Figma pendiente](#6-prototipo-figma-pendiente)
7. [Orden de trabajo, reparto y cronograma restante](#7-orden-de-trabajo-reparto-y-cronograma-restante)
8. [Cómo verificar cada avance](#8-cómo-verificar-cada-avance)
9. [Definición de terminado y checklist de entrega](#9-definición-de-terminado-y-checklist-de-entrega)

---

## 0. Antes de empezar

- [ ] **Publicar la documentación.** `docs/` solo existe en el equipo de Jhan (no está en GitHub): subirla en la rama `docs/plan-integral` con PR para que todo el equipo la vea.
- [ ] **Ramas y PR.** Se sigue subiendo directo a `main` (commits `00f25ea` y `b4f593d`). Pasar a una rama por tarea (`feat/m1-…`, `fix/d1-…`) con PR pequeño y 1 revisión ([`PLAN_INTEGRAL.md` §14](PLAN_INTEGRAL.md)). El CI ya existe (`.github/workflows/ci.yml`): que bloquee el merge si falla.
- [ ] **Levantar el entorno:**
  ```bash
  git pull
  npm install
  docker compose up -d db
  npm run db:migrate        # aplica 20261012140000_modulos_operacion y 20261012180000_clave_y_jobs
  npm run dev               # http://localhost:3000   (los jobs arrancan solos con el servidor)
  npm test                  # 8 pruebas unitarias (node:test + tsx)
  ```
  Con datos existentes **no** correr `db:seed` (borra todo). Falta `.env.example` (ver F0).
- [ ] **Leer** `AGENTS.md` (Next 16) y [`PLAN_INTEGRAL.md` §3.1](PLAN_INTEGRAL.md) (cambios aditivos; módulo apagado = comportamiento original).

---

## 1. Resumen del estado

### 1.1 Módulos

| Módulo | Avance | Horas restantes (aprox.) | Qué hay (verificado) | Brecha principal |
|---|---|---|---|---|
| **M1** Prioridades | ≈ 70 % | **14** | Categorías, α, tope, clave de orden, `resolverCategoria` (corrige C1), `recalcularClaves`, `PATCH /turnos/:id/prioridad` (verificar/rechazar/cambiar), ticket con categoría, botones en el panel | SQL de selección (`SKIP LOCKED`), lógica pura + pruebas, CRUD de categorías, vista previa |
| **M2** Predicción | ≈ 15 % | **48** | `cuantiles.ts` (tipo 7), `modelos.ts` (3 modelos), `mejores-horas` y rango p50/p90 al cliente | Sin walk-forward ni intervalos, estado global en memoria, no usa `delante` ni `c` |
| **M3** Citas | ≈ 40 % | **38** | Rutas públicas con límite de peticiones, página `/l/[slug]/citas`, slots calculados, `.ics`, PIN, no-show y recordatorios en el job | Sin tabla de *slots*, reserva no atómica, PIN no rotativo, sin cancelar/reprogramar |
| **M4** Chatbot | ≈ 25 % | **42** | FSM de 4 estados, webhook de mensajes entrantes (OpenWA), bandeja `/admin/bandeja` | Sesiones y bandeja en memoria y **sin filtro por local**, sin consentimiento, sin idempotencia ni *handoff* real |
| **M5** Kiosco | ≈ 25 % | **54** | Página `/kiosco`, *outbox* en `localStorage`, `sw.js`, emparejamiento por código, `POST /kiosco/turnos` | Sin autenticación de dispositivo, idempotencia en memoria, SW demasiado amplio, sin *sync* por lotes ni reloj |
| **M6** Transferencia y balanceo | ≈ 25 % | **42** | `transferirTurno` (+ auditoría), `sugerirMovimiento`, `POST /balanceo`, balanceo automático en el job | Sin reglas/histéresis/simulación/reversión; el automático actúa en todos los locales |
| **M7** Analítica y SLA | ≈ 20 % | **48** | Página `/admin/analitica` (CSAT, estados, llegadas por hora), `cumplimientoSla`, alerta SLA en `auditoria`, PDF simple, correo | Sin MV/percentiles/mapa de calor real, sin motor de alertas, SLA contradice RN-M7-01, correo no envía |
| **M8** Simulador | ≈ 45 % | **30** | `erlang.ts` estable + `minimoServidores`, `des.ts`, página con Erlang C y "Simular 4 horas" | DES simplificado, sin IC/CRN/Worker/calibración/*backtest* |
| | | **≈ 316 h** | | |

### 1.2 Totales

| Bloque | Horas restantes |
|---|---|
| Módulos | ≈ 316 |
| Fundaciones obligatorias (F0, F1, F3, F5, F6, F8, F10) | ≈ 57 |
| Núcleo (N01…N11 pendientes) | ≈ 30 |
| Defectos nuevos (§3) + restos de Ola 0 | ≈ 25 |
| **Total obligatorio** | **≈ 430 h** (de las 626 h del plan original) |
| Opcionales (F2, F4, F7, F9, N10) | ≈ 50 h |

---

## 2. Correcciones: lo que se arregló y lo que sigue pendiente (Ola 0)

Estado de los 19 hallazgos de la versión anterior:

| ID | Hallazgo | Estado | Evidencia / lo que falta |
|---|---|---|---|
| C1 | Cliente se declaraba EMERGENCIA y se saltaba la fila | ✅ **Corregido y probado** | `resolverCategoria` (`backend/src/operacion.ts:15`) valida origen y `visibleCliente`; `POST /public/turnos` con `EMERGENCIA` ⇒ `M1_CATEGORIA_NO_DISPONIBLE`. **Falta la prueba automática de regresión.** |
| C2 | Dos ventanillas llamaban el mismo turno | ◐ Mitigado | `backend/src/turnos.ts` (`llamarSiguiente`) ahora usa `updateMany` con guarda y reintenta hasta 5 veces. Falta la versión SQL con `FOR UPDATE SKIP LOCKED` (M1-T03) y que el contador del tope (`registrarLlamadoPrioridad`) sea atómico |
| C3 | Endpoints públicos sin protección en `/operacion` | ✅ **Corregido** | Se eliminaron `PUT`/`PATCH` (devuelven 405); rutas nuevas con `rateLimit`. **Quedan:** `PUT /kiosco/emparejar` sin límite y `GET /public/colas/:id/mejores-horas` sin límite |
| C4 | Cambiar pesos/α no recalculaba claves | ✅ Corregido | `recalcularClaves` (`operacion.ts`) se llama al guardar. *(mejora: hacerlo en una sola sentencia SQL en vez de un `update` por turno)* |
| C5 | Prioridad aplicada después de emitir y errores silenciados | ◐ Mitigado | Ahora se valida **antes** de emitir y, si falla después, se borra el turno. Sigue en Node: pasar a `emitir_turno()` (F5) |
| C6 | `llamarSiguiente` sin `orderBy` (200 candidatos) | ✅ Corregido | `orderBy [claveOrden desc, emitidoAt, id]`, `take: 30` |
| C7 | RN04 activada por defecto con `setInterval` | ◐ Sin cambios de fondo | `tiempoAusenciaSeg` sigue en `180` (`schema.prisma:115`); el `setInterval` ahora ejecuta `correrJobs()` (`backend/src/jobs/runner.ts`). Decidir: opt-in (`NULL`) o documentar; migrar a `pg-boss` |
| C8 | Citas: cupo fijo y no atómico | ◐ Parcial | Hay slots virtuales y rutas, pero **sigue sin ser atómico** (ver D7) |
| C9 | Transferencia no transaccional | ◐ Parcial | Solo se añadió auditoría (`TRANSFERIR_TURNO`). Sigue sin transacción, motivo, `sucesor_id`, redirección ni aviso |
| C10 | Erlang C inestable | ✅ Corregido | `backend/src/capacidad/erlang.ts` (recursión de Erlang B) + `minimoServidores`. Faltan los vectores de prueba conocidos (`c=1,λ=.5,μ=1 ⇒ C=.5`; `c=2,λ=1,μ=1 ⇒ C=1/3`; `λ=30,5 min,c=3 ⇒ SL≈84 %`) |
| C11 | Ticket sin categoría | ✅ Corregido | `turnos/ticket/route.ts` acepta `categoriaCodigo` (origen `PERSONAL`) |
| C12 | Panel sin verificar/rechazar | ◐ Parcial | Botones "Verificar" y "No corresponde" en `panel-ventanilla.tsx`; falta la **explicación del puntaje** |
| C13 | Heurística PRO de `tiempoEstimado` | ◐ | Se añadió `prediccion {p50Min,p90Min}` a `obtenerTurnoPorToken`; ver D9 |
| C14 | Banderas por nombre de plan | ◐ Parcial | `backend/src/modulos.ts` es un mapa fijo por plan; solo lo usan `operacion.ts`, `turnos.ts` y el hub. **M2, M5, M6, M7 y M8 no comprueban la bandera** |
| C15 | Tope con `colaId` del primer candidato | ◐ | `colaTope = ventanilla.colaId ?? candidatos[0]?.colaId`; definir tope por ventanilla/local |
| C16 | Entrypoint terminaba sesiones de la BD | ✅ Corregido | Se quitó el bloque `pg_terminate_backend` de `docker-entrypoint.sh` |
| C17 | `/admin/operacion` mezclado | ◐ | Se corrigió la creación de cita (usa `/public/citas` con `slug`); sigue siendo una sola pantalla |
| C18 | Seed sin citas/valoraciones | ❌ | `backend/prisma/seed.ts` no cambió |
| C19 | Sin pruebas | ◐ | Hay `backend/tests/erlang.test.ts` (8 pruebas unitarias) y CI; ver F0 |

---

## 3. Defectos nuevos encontrados en el último commit

Revisados leyendo el código; los marcados con (probado) se comprobaron contra la app en marcha.

### P0 / P1 — seguridad y privacidad

| ID | Hallazgo | Evidencia | Corrección |
|---|---|---|---|
| **D1** | **Fuga entre locales en el chatbot:** la bandeja es una lista global en memoria y cualquier OPERADOR/ADMIN de cualquier local ve los teléfonos de todos; además el bot asigna **siempre el primer local activo** | `backend/src/bot/bandeja.ts` (array global), `frontend/src/app/api/v1/bot/bandeja/route.ts` (sin filtro), `backend/src/bot/procesar.ts:9` (`findFirst orderBy id`) | Tablas `canal_whatsapp`, `conversacion_bot`, `mensaje_bot` con `local_id`; resolver el local por la sesión/número de OpenWA; filtrar por `localId` ([`M4` §5–6](modulos/M4-chatbot-whatsapp.md)) |
| **D2** | **Service Worker de alcance total:** `/sw.js` se registra con alcance `/` y guarda en caché **toda** respuesta GET (incluye `/api/v1/auth/me`, panel y admin) | `public/sw.js`, `frontend/src/app/kiosco/page.tsx:30` | Servirlo desde `/kiosco/sw.js` con alcance `/kiosco`, precache solo del *shell*, excluir `/api/` y páginas autenticadas |
| **D3** | **Kiosco sin autenticación de dispositivo:** `POST /kiosco/turnos` es público (cualquiera emite turnos `KIOSCO`); el emparejamiento solo devuelve `localId` (sin token); códigos y claves de idempotencia en memoria; la búsqueda del turno previo usa `body.id.slice(0,16)` como token (nunca coincide); la clave de cifrado del *outbox* se deriva del código de 6 dígitos; usa `localStorage`; el *slug* `policlinico-san-roman` está fijo | `frontend/src/app/api/v1/kiosco/*`, `backend/src/kiosco/emparejar.ts`, `frontend/src/app/kiosco/page.tsx` | Dispositivo con token (hash en BD), `clave_idem` única en BD, `POST /kiosco/sync` por lotes, IndexedDB + clave WebCrypto no extraíble ([`M5`](modulos/M5-kiosco-offline.md)) |
| **D4** | **Avisos duplicados y sin control:** el job envía WhatsApp "tu turno está a ~N min" a **todo cliente en espera con celular**, sin mirar plan/cupo/consentimiento ni registrar `notificacion`, y se suma a `revisarAvisos`; los recordatorios de citas igual; ambos usan `Set` en memoria (se repiten al reiniciar o con varias instancias) | `backend/src/jobs/runner.ts` (`avisosCita`, `avisadosMinutos`) | Tablas `cita_recordatorio` (clave `(cita, tipo)`) y `aviso_min_antes` por turno con consentimiento; respetar `maxAvisosWhatsapp` y registrar en `notificacion` |
| **D5** | **Balanceo automático para todos los locales:** cada 30 min mueve ventanillas de forma permanente en **todos** los locales activos, sin módulo, sin simulación, sin reversión ni auditoría (la ruta manual sí audita) | `runner.ts` (bloque `ultimoBalanceo`), `backend/src/balanceo/reglas.ts` | Motor de reglas por local con modo simulación, histéresis, reversión y límite por hora ([`M6` §6.4](modulos/M6-transferencia-balanceo.md)); respetar la bandera M6 |
| **D6** | **Datos personales de citas en claro:** `cita.nombre` y `cita.telefono` sin cifrar ni hash, y la purga de 90 días no los toca; el bot y el check-in fijan `consentimiento: true` sin preguntar | `backend/prisma/schema.prisma` (`Cita`), `backend/src/operacion.ts` (`checkInCita`), `backend/src/bot/procesar.ts:20` | Reutilizar `Cliente` (cifrado + hash), incluir citas en `purgarDatosPersonales`, preguntar el consentimiento en el bot (estado `PEDIR_CONSENTIMIENTO`) |
| **D7** | **Citas: sobrecupo posible y PIN débil:** `count` + `create` dentro de una transacción en `READ COMMITTED` no impide pasar de 3; los slots son virtuales; el PIN son los **últimos 4 caracteres del token** (fijo, no prueba presencia) y el check-in sin PIN lo omite | `backend/src/operacion.ts` (`crearCita`, `slotsCita`, `pinCita`, `checkInCita`) | Tabla `slot` + `UPDATE … WHERE reservados < capacidad`; PIN rotativo HMAC por ventana de 5 min ([`M3` §6.2, §6.5](modulos/M3-citas-reservas.md)) |
| **D8** | **Job runner frágil:** inserta una fila en `job_interno` **cada 30 s** sin limpieza (≈ 2 880/día; comprobado: crece 1 por ciclo); el candado `ocupado` es por proceso; la purga corre en **cada ciclo** de la hora 3 (hora del servidor, no del local); `reentrenar` alimenta un modelo **global en memoria** con los últimos 100 turnos de *todos* los locales | `backend/src/jobs/runner.ts`, `backend/src/prediccion/modelo.ts` | Migrar a `pg-boss` (F1) con `singletonKey` y cron por job; quitar `job_interno`; modelo por (local, cola) persistido |

### P2 — calidad

| ID | Hallazgo | Evidencia | Corrección |
|---|---|---|---|
| **D9** | **M2 sesgado y sin contexto:** `ajustarModelos` mide el error **dentro de la muestra** (el modelo estacional incluye cada dato en su propio promedio); el rango p50/p90 no depende de `delante`/`c` y puede ser absurdo (p90 = 189 min en la demo) (probado) | `backend/src/prediccion/modelos.ts`, `backend/src/turnos.ts` (`prediccion`) | *Replay* cronológico/walk-forward, intervalos conformalizados, entrada `delante`/`c` ([`M2` §6](modulos/M2-prediccion-espera.md)) |
| **D10** | **Bot incompleto:** la opción `0` (persona) no detiene al bot; el enlace enviado es relativo (`/t/<token>`, inútil en WhatsApp: usar `appUrl()`); sin normalización de texto, contador de intentos ni idempotencia por `messageId` | `backend/src/bot/fsm.ts`, `procesar.ts` | [`M4` §6.3–6.5](modulos/M4-chatbot-whatsapp.md) |
| **D11** | **SLA contradice el plan:** `cumplimientoSla` **ignora** a quien sigue esperando y su prueba lo exige; las alertas se guardan como filas de `auditoria` sin ciclo de vida | `backend/src/analitica/sla.ts`, `backend/tests/erlang.test.ts` | Censura a la derecha (RN-M7-01: en espera con edad > objetivo = incumple); tablas `alerta`/`regla_alerta` ([`M7` §6.3, §6.5](modulos/M7-analitica-sla.md)) |
| **D12** | **El correo nunca se envía:** `nodemailer` no está en `package.json` y se carga con `new Function("return import(...)")`; el PDF es un PDF manual de texto | `backend/src/correo.ts`, `frontend/src/app/api/v1/reportes/pdf/route.ts` | Añadir `nodemailer` y `@react-pdf/renderer` ([`M7` §6.7](modulos/M7-analitica-sla.md)) |
| **D13** | **DES simplificado:** recursión por servidor (el cliente abandona al llegar si la espera supera su paciencia), LCG como PRNG, sin llegadas no homogéneas, *no-show*, IC ni CRN | `backend/src/capacidad/des.ts` | [`M8` §6.2–6.3](modulos/M8-simulador-capacidad.md) |
| **D14** | **Pruebas insuficientes:** 8 pruebas unitarias; ninguna cubre C1, C2, C4, los SQL ni la API; CI corre con una `DATABASE_URL` falsa; `.env.example` **sigue sin existir** | `backend/tests/`, `.github/workflows/ci.yml` | F0 |
| **D15** | **Bandera de módulo incompleta:** `/admin/simulador`, `/admin/analitica`, `/kiosco`, `/admin/bandeja` no comprueban el plan; el hub solo informa, no permite activar por local | `backend/src/modulos.ts`, páginas admin | F3 completa (tablas `plan_modulo`/`local_modulo`, `exigirModulo`) |
| **D16** | `calcular_clave_orden()` existe en SQL pero **no se usa** y no recibe el indicador de *aging*; no hay `posicion_turno()` ni `siguienteTurno()` en SQL | migración `20261012180000_clave_y_jobs` | F5 / M1-T03 |

---

## 4. Fundaciones y núcleo

### Fundaciones

| ID | Estado | Qué falta | Horas |
|---|---|---|---|
| **F0** pruebas/CI | ◐ | CI y 8 pruebas unitarias ✓. **Completado el 13/10 (segunda parte):** pantallas de auditoría (filtros, detalle, CSV), planes (matriz plan × módulo) y jobs; `seed.ts` con módulos, citas, SLA y canal del bot; `seed-historico.ts` (F8, 60 días); lint y `npm run build` limpios; prueba manual en el navegador de: hub, prioridades, predicción (modelo estacional entrenado con el histórico: error 1,2–2 min vs 3–16 min de la base), analítica, simulador (Worker), tomar turno con prioridad, mi turno (rango, aviso, mejores horas), panel (explicación, PIN, transferir con redirección), reserva de cita y `/c/[token]`, kiosco (emparejar, emitir en línea y **sin conexión con sincronización posterior sin duplicados**). Ver [`ARQUITECTURA.md`](ARQUITECTURA.md).

**Falta (fuera del código o necesita al equipo):**
- Figma (el conector sigue limitado) y capturas para el informe.
- Probar el bot con un número real: volver a registrar el webhook de OpenWA (Admin → Avisos WhatsApp) para recibir `message.received`.
- Generar secretos de producción (`.env` local usa la clave de ejemplo; la app no arranca en producción con ella).
- Playwright E2E y k6 (las pruebas de integración cubren los escenarios críticos a nivel de servicio).
- Informe técnico, manuales, video y ensayo de la demo.
