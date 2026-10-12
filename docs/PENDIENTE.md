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
| C1 | Cliente se declaraba EMERGENCIA y se saltaba la fila | ✅ **Corregido y probado** | `resolverCategoria` (`src/lib/operacion.ts:15`) valida origen y `visibleCliente`; `POST /public/turnos` con `EMERGENCIA` ⇒ `M1_CATEGORIA_NO_DISPONIBLE`. **Falta la prueba automática de regresión.** |
| C2 | Dos ventanillas llamaban el mismo turno | ◐ Mitigado | `src/lib/turnos.ts` (`llamarSiguiente`) ahora usa `updateMany` con guarda y reintenta hasta 5 veces. Falta la versión SQL con `FOR UPDATE SKIP LOCKED` (M1-T03) y que el contador del tope (`registrarLlamadoPrioridad`) sea atómico |
| C3 | Endpoints públicos sin protección en `/operacion` | ✅ **Corregido** | Se eliminaron `PUT`/`PATCH` (devuelven 405); rutas nuevas con `rateLimit`. **Quedan:** `PUT /kiosco/emparejar` sin límite y `GET /public/colas/:id/mejores-horas` sin límite |
| C4 | Cambiar pesos/α no recalculaba claves | ✅ Corregido | `recalcularClaves` (`operacion.ts`) se llama al guardar. *(mejora: hacerlo en una sola sentencia SQL en vez de un `update` por turno)* |
| C5 | Prioridad aplicada después de emitir y errores silenciados | ◐ Mitigado | Ahora se valida **antes** de emitir y, si falla después, se borra el turno. Sigue en Node: pasar a `emitir_turno()` (F5) |
| C6 | `llamarSiguiente` sin `orderBy` (200 candidatos) | ✅ Corregido | `orderBy [claveOrden desc, emitidoAt, id]`, `take: 30` |
| C7 | RN04 activada por defecto con `setInterval` | ◐ Sin cambios de fondo | `tiempoAusenciaSeg` sigue en `180` (`schema.prisma:115`); el `setInterval` ahora ejecuta `correrJobs()` (`src/lib/jobs/runner.ts`). Decidir: opt-in (`NULL`) o documentar; migrar a `pg-boss` |
| C8 | Citas: cupo fijo y no atómico | ◐ Parcial | Hay slots virtuales y rutas, pero **sigue sin ser atómico** (ver D7) |
| C9 | Transferencia no transaccional | ◐ Parcial | Solo se añadió auditoría (`TRANSFERIR_TURNO`). Sigue sin transacción, motivo, `sucesor_id`, redirección ni aviso |
| C10 | Erlang C inestable | ✅ Corregido | `src/lib/capacidad/erlang.ts` (recursión de Erlang B) + `minimoServidores`. Faltan los vectores de prueba conocidos (`c=1,λ=.5,μ=1 ⇒ C=.5`; `c=2,λ=1,μ=1 ⇒ C=1/3`; `λ=30,5 min,c=3 ⇒ SL≈84 %`) |
| C11 | Ticket sin categoría | ✅ Corregido | `turnos/ticket/route.ts` acepta `categoriaCodigo` (origen `PERSONAL`) |
| C12 | Panel sin verificar/rechazar | ◐ Parcial | Botones "Verificar" y "No corresponde" en `panel-ventanilla.tsx`; falta la **explicación del puntaje** |
| C13 | Heurística PRO de `tiempoEstimado` | ◐ | Se añadió `prediccion {p50Min,p90Min}` a `obtenerTurnoPorToken`; ver D9 |
| C14 | Banderas por nombre de plan | ◐ Parcial | `src/lib/modulos.ts` es un mapa fijo por plan; solo lo usan `operacion.ts`, `turnos.ts` y el hub. **M2, M5, M6, M7 y M8 no comprueban la bandera** |
| C15 | Tope con `colaId` del primer candidato | ◐ | `colaTope = ventanilla.colaId ?? candidatos[0]?.colaId`; definir tope por ventanilla/local |
| C16 | Entrypoint terminaba sesiones de la BD | ✅ Corregido | Se quitó el bloque `pg_terminate_backend` de `docker-entrypoint.sh` |
| C17 | `/admin/operacion` mezclado | ◐ | Se corrigió la creación de cita (usa `/public/citas` con `slug`); sigue siendo una sola pantalla |
| C18 | Seed sin citas/valoraciones | ❌ | `prisma/seed.ts` no cambió |
| C19 | Sin pruebas | ◐ | Hay `tests/erlang.test.ts` (8 pruebas unitarias) y CI; ver F0 |

---

## 3. Defectos nuevos encontrados en el último commit

Revisados leyendo el código; los marcados con (probado) se comprobaron contra la app en marcha.

### P0 / P1 — seguridad y privacidad

| ID | Hallazgo | Evidencia | Corrección |
|---|---|---|---|
| **D1** | **Fuga entre locales en el chatbot:** la bandeja es una lista global en memoria y cualquier OPERADOR/ADMIN de cualquier local ve los teléfonos de todos; además el bot asigna **siempre el primer local activo** | `src/lib/bot/bandeja.ts` (array global), `src/app/api/v1/bot/bandeja/route.ts` (sin filtro), `src/lib/bot/procesar.ts:9` (`findFirst orderBy id`) | Tablas `canal_whatsapp`, `conversacion_bot`, `mensaje_bot` con `local_id`; resolver el local por la sesión/número de OpenWA; filtrar por `localId` ([`M4` §5–6](modulos/M4-chatbot-whatsapp.md)) |
| **D2** | **Service Worker de alcance total:** `/sw.js` se registra con alcance `/` y guarda en caché **toda** respuesta GET (incluye `/api/v1/auth/me`, panel y admin) | `public/sw.js`, `src/app/kiosco/page.tsx:30` | Servirlo desde `/kiosco/sw.js` con alcance `/kiosco`, precache solo del *shell*, excluir `/api/` y páginas autenticadas |
| **D3** | **Kiosco sin autenticación de dispositivo:** `POST /kiosco/turnos` es público (cualquiera emite turnos `KIOSCO`); el emparejamiento solo devuelve `localId` (sin token); códigos y claves de idempotencia en memoria; la búsqueda del turno previo usa `body.id.slice(0,16)` como token (nunca coincide); la clave de cifrado del *outbox* se deriva del código de 6 dígitos; usa `localStorage`; el *slug* `policlinico-san-roman` está fijo | `src/app/api/v1/kiosco/*`, `src/lib/kiosco/emparejar.ts`, `src/app/kiosco/page.tsx` | Dispositivo con token (hash en BD), `clave_idem` única en BD, `POST /kiosco/sync` por lotes, IndexedDB + clave WebCrypto no extraíble ([`M5`](modulos/M5-kiosco-offline.md)) |
| **D4** | **Avisos duplicados y sin control:** el job envía WhatsApp "tu turno está a ~N min" a **todo cliente en espera con celular**, sin mirar plan/cupo/consentimiento ni registrar `notificacion`, y se suma a `revisarAvisos`; los recordatorios de citas igual; ambos usan `Set` en memoria (se repiten al reiniciar o con varias instancias) | `src/lib/jobs/runner.ts` (`avisosCita`, `avisadosMinutos`) | Tablas `cita_recordatorio` (clave `(cita, tipo)`) y `aviso_min_antes` por turno con consentimiento; respetar `maxAvisosWhatsapp` y registrar en `notificacion` |
| **D5** | **Balanceo automático para todos los locales:** cada 30 min mueve ventanillas de forma permanente en **todos** los locales activos, sin módulo, sin simulación, sin reversión ni auditoría (la ruta manual sí audita) | `runner.ts` (bloque `ultimoBalanceo`), `src/lib/balanceo/reglas.ts` | Motor de reglas por local con modo simulación, histéresis, reversión y límite por hora ([`M6` §6.4](modulos/M6-transferencia-balanceo.md)); respetar la bandera M6 |
| **D6** | **Datos personales de citas en claro:** `cita.nombre` y `cita.telefono` sin cifrar ni hash, y la purga de 90 días no los toca; el bot y el check-in fijan `consentimiento: true` sin preguntar | `prisma/schema.prisma` (`Cita`), `src/lib/operacion.ts` (`checkInCita`), `src/lib/bot/procesar.ts:20` | Reutilizar `Cliente` (cifrado + hash), incluir citas en `purgarDatosPersonales`, preguntar el consentimiento en el bot (estado `PEDIR_CONSENTIMIENTO`) |
| **D7** | **Citas: sobrecupo posible y PIN débil:** `count` + `create` dentro de una transacción en `READ COMMITTED` no impide pasar de 3; los slots son virtuales; el PIN son los **últimos 4 caracteres del token** (fijo, no prueba presencia) y el check-in sin PIN lo omite | `src/lib/operacion.ts` (`crearCita`, `slotsCita`, `pinCita`, `checkInCita`) | Tabla `slot` + `UPDATE … WHERE reservados < capacidad`; PIN rotativo HMAC por ventana de 5 min ([`M3` §6.2, §6.5](modulos/M3-citas-reservas.md)) |
| **D8** | **Job runner frágil:** inserta una fila en `job_interno` **cada 30 s** sin limpieza (≈ 2 880/día; comprobado: crece 1 por ciclo); el candado `ocupado` es por proceso; la purga corre en **cada ciclo** de la hora 3 (hora del servidor, no del local); `reentrenar` alimenta un modelo **global en memoria** con los últimos 100 turnos de *todos* los locales | `src/lib/jobs/runner.ts`, `src/lib/prediccion/modelo.ts` | Migrar a `pg-boss` (F1) con `singletonKey` y cron por job; quitar `job_interno`; modelo por (local, cola) persistido |

### P2 — calidad

| ID | Hallazgo | Evidencia | Corrección |
|---|---|---|---|
| **D9** | **M2 sesgado y sin contexto:** `ajustarModelos` mide el error **dentro de la muestra** (el modelo estacional incluye cada dato en su propio promedio); el rango p50/p90 no depende de `delante`/`c` y puede ser absurdo (p90 = 189 min en la demo) (probado) | `src/lib/prediccion/modelos.ts`, `src/lib/turnos.ts` (`prediccion`) | *Replay* cronológico/walk-forward, intervalos conformalizados, entrada `delante`/`c` ([`M2` §6](modulos/M2-prediccion-espera.md)) |
| **D10** | **Bot incompleto:** la opción `0` (persona) no detiene al bot; el enlace enviado es relativo (`/t/<token>`, inútil en WhatsApp: usar `appUrl()`); sin normalización de texto, contador de intentos ni idempotencia por `messageId` | `src/lib/bot/fsm.ts`, `procesar.ts` | [`M4` §6.3–6.5](modulos/M4-chatbot-whatsapp.md) |
| **D11** | **SLA contradice el plan:** `cumplimientoSla` **ignora** a quien sigue esperando y su prueba lo exige; las alertas se guardan como filas de `auditoria` sin ciclo de vida | `src/lib/analitica/sla.ts`, `tests/erlang.test.ts` | Censura a la derecha (RN-M7-01: en espera con edad > objetivo = incumple); tablas `alerta`/`regla_alerta` ([`M7` §6.3, §6.5](modulos/M7-analitica-sla.md)) |
| **D12** | **El correo nunca se envía:** `nodemailer` no está en `package.json` y se carga con `new Function("return import(...)")`; el PDF es un PDF manual de texto | `src/lib/correo.ts`, `src/app/api/v1/reportes/pdf/route.ts` | Añadir `nodemailer` y `@react-pdf/renderer` ([`M7` §6.7](modulos/M7-analitica-sla.md)) |
| **D13** | **DES simplificado:** recursión por servidor (el cliente abandona al llegar si la espera supera su paciencia), LCG como PRNG, sin llegadas no homogéneas, *no-show*, IC ni CRN | `src/lib/capacidad/des.ts` | [`M8` §6.2–6.3](modulos/M8-simulador-capacidad.md) |
| **D14** | **Pruebas insuficientes:** 8 pruebas unitarias; ninguna cubre C1, C2, C4, los SQL ni la API; CI corre con una `DATABASE_URL` falsa; `.env.example` **sigue sin existir** | `tests/`, `.github/workflows/ci.yml` | F0 |
| **D15** | **Bandera de módulo incompleta:** `/admin/simulador`, `/admin/analitica`, `/kiosco`, `/admin/bandeja` no comprueban el plan; el hub solo informa, no permite activar por local | `src/lib/modulos.ts`, páginas admin | F3 completa (tablas `plan_modulo`/`local_modulo`, `exigirModulo`) |
| **D16** | `calcular_clave_orden()` existe en SQL pero **no se usa** y no recibe el indicador de *aging*; no hay `posicion_turno()` ni `siguienteTurno()` en SQL | migración `20261012180000_clave_y_jobs` | F5 / M1-T03 |

---

## 4. Fundaciones y núcleo

### Fundaciones

| ID | Estado | Qué falta | Horas |
|---|---|---|---|
| **F0** pruebas/CI | ◐ | CI y 8 pruebas unitarias ✓. **Falta:** `.env.example`; BD de pruebas (Testcontainers/compose); **pruebas de caracterización** del núcleo; pruebas de C1, C2, C4 y de API; Playwright | 10 |
| **F1** scheduler | ◐ | `correrJobs()` con `setInterval` funciona pero es monolítico (D8). **Falta:** `pg-boss`, un job por tarea con cron y `singletonKey`, `/api/health` con estado de jobs | 10 |
| **F3** banderas | ◐ | Mapa fijo por plan (D15). **Falta:** tablas `plan_modulo`/`local_modulo`, `exigirModulo` en API **y** UI de todos los módulos, interruptor por local en el hub | 5 |
| **F5** `emitir_turno()`/`siguienteTurno()` | ◐ | Columnas y enums ✓; la lógica vive en Node. **Falta:** sobrecarga SQL con categoría/fecha/origen; `siguienteTurno` con `SKIP LOCKED`; `posicion_turno()`; columnas `cita_id`, `origen_dispositivo_id`, `codigo_provisional`, `sucesor_id`, `delante_emision`, `ventanillas_activas_emision`; índice parcial | 8 |
| **F6** observabilidad | ❌ | Logger JSON con `request_id`, `/api/metrics` | 8 |
| **F8** datos históricos | ❌ | `prisma/seed-historico.ts` (60 días, Poisson, log-normal, categorías, valoraciones, citas) — necesario para M2, M7 y M8 | 10 |
| **F10** accesibilidad/i18n | ❌ | `lang="es-PE"`, contraste, objetivos táctiles | 6 |
| *Opcionales* F2 bus `LISTEN/NOTIFY` · F4 auditoría con actor (hoy solo algunas rutas pasan `usuarioId` a mano) · F7 seguridad base · F9 diseño | ❌ | Ver [`PLAN_INTEGRAL.md` §3.1](PLAN_INTEGRAL.md) | 40 |

### Núcleo

| ID | Estado | Qué falta | Horas |
|---|---|---|---|
| N01 `/admin/auditoria` | ◐ | Existe una tabla simple (80 filas). Falta filtros, búsqueda, detalle del `datos_json` y exportar CSV | 3 |
| N02 `/panel/historial` | ❌ | `GET /api/v1/turnos?ventanillaId&fecha&estado&cursor` + página | 6 |
| N03 hub `/admin/modulos` | ◐ | Muestra "incluido / no incluido"; falta interruptor por local y estado de cada módulo (depende de F3) | 3 |
| N04 expiración RN04 | ◐ | Funciona (ver C7); falta decisión opt-in, job propio, aviso al cliente | 2 |
| N05 horario / cola cerrada | ◐ | `localAbierto` y `COLA_CERRADA` ✓; falta mostrarlo en la UI del cliente y `proximaApertura` | 2 |
| N06 turno vencido | ◐ | Mensaje "Tu turno venció" en `mi-turno.tsx` ✓; falta el botón "Tomar un nuevo turno" | 1 |
| N07 valoración | ✅ | `POST /public/turnos/:token/valoracion` con límite de peticiones y UI | 0 |
| N08 CRUD de planes + `plan_modulo` | ❌ | Para SUPER_ADMIN | 4 |
| N09 purga programada | ◐ | Se ejecuta en el job (ver D8); falta correrla **una vez al día** en la zona del local e incluir citas (D6) | 1 |
| N10 recuperar contraseña *(opc.)* | ❌ | — | 10 |
| N11 `.env.example`, `docs/ARQUITECTURA.md`, OpenAPI | ❌ | — | 8 |

---

## 5. Módulos: qué existe y qué falta

`[x]` hecho · `[~]` parcial (se indica qué falta) · `[ ]` pendiente. IDs `Mx-Tnn` de cada documento de módulo.

### M1 · Prioridades — *Integrante 1 · ≈ 14 h* · [`modulos/M1`](modulos/M1-prioridades.md)
- [x] **T01** Tablas, clave de orden, índice `ix_turno_espera`, seed por migración.
- [~] **T02** `claveOrden`/`elegirSiguiente`/`recalcularClaves` en `operacion.ts` mezclados con Prisma → extraer a `src/lib/prioridades/reglas.ts` **puro** (`ordenar`, `seleccionarSiguiente`, `explicarPuntaje`, `simular`) con pruebas unitarias y de propiedades (no-inanición, tope, estabilidad).
- [ ] **T03** `siguienteTurno` en SQL con `SKIP LOCKED` y contador atómico (C2, C15).
- [x] **T04** Validación de categoría antes de emitir; posición y avisos con la clave. [~] Mover el cálculo a `emitir_turno()` (C5/D16).
- [~] **T05** `PATCH /turnos/:id/prioridad` ✓, ticket con categoría ✓, recálculo ✓. **Falta** CRUD de categorías (`M1_NO_ELIMINAR_GENERAL`, `M1_LIMITE_CATEGORIAS`), `POST /prioridades/simular`.
- [~] **T06** UI admin: pesos, α, tope ✓. **Falta** CRUD, sliders, interruptores y **vista previa FIFO vs priorizado**.
- [~] **T07** Panel: badge, Verificar, No corresponde ✓. **Falta** `ExplicacionPuntaje`.
- [~] **T08** Privacidad: la categoría no sale en TV/WhatsApp ✓; **falta la prueba automática**.
- [ ] **T09** E2E (escenario 4), métricas, manual del operador.

### M2 · Predicción de espera — *Integrante 1 · ≈ 48 h* · [`modulos/M2`](modulos/M2-prediccion-espera.md)
- [x] `cuantil` tipo 7 (con prueba).
- [~] `modelos.ts` (BASELINE/EMA/ESTACIONAL) → corregir D9; `mejores-horas` básico ✓; rango p50/p90 al cliente ✓ (mejorar).
- [ ] **T01** Migración: `config_prediccion`, `modelo_entrenado`, `prediccion_log`, columnas `delante_emision`, `ventanillas_activas_emision`, `aviso_min_antes` (4 h).
- [ ] **T03/T04** Modelos con entrada `delante`/`c`, contracción κ=10, φ acotado; intervalos conformalizados (14 h).
- [ ] **T05** *Replay* cronológico + walk-forward + métricas (8 h) · **T06** importancia por permutación (3 h).
- [ ] **T07** Jobs `reentrenar`/`flush`/`deriva` con modelo **por cola y persistido**, selección AUTO con histéresis 5 % (6 h) · **T08** API de métricas/config/reentrenar (6 h).
- [ ] **T09** Integración con `turnos.ts` y aviso "X min antes" **con opt-in del cliente** (4 h) · **T10** UI admin y cliente + E2E (8 h).

### M3 · Citas y reservas — *Integrante 2 · ≈ 38 h* · [`modulos/M3`](modulos/M3-citas-reservas.md)
- [x] Rutas públicas (`/public/citas`, `…/checkin`, `…/ics`, `/public/locales/:slug/citas`) con límite de peticiones; página `/l/[slug]/citas`; no-show y recordatorios en el job.
- [ ] **T01** Modelo completo: `config_citas`, `bloqueo_agenda`, `slot` (+ `CHECK`), `cita` con `slot_id`/`cliente_id`/`fecha`/`codigo_checkin`, `cita_evento`, `cita_recordatorio`, `bloqueo_cliente`, `idempotencia`; índice `ux_cita_activa`; **migrar las citas existentes y dejar de guardar nombre/teléfono en claro (D6)** (5 h).
- [ ] **T02** Generación de slots persistidos y zona horaria (4 h).
- [ ] **T03** Reservar/cancelar/reprogramar **atómicos** + idempotencia + prueba de 50 reservas simultáneas (D7) (9 h).
- [~] **T04** Reglas puras: ventana **−10/+15** (hoy −20/+15), estados, no-show, bloqueo por reincidencia (3 h).
- [ ] **T05** PIN rotativo HMAC y creación del turno con `emitido_at = max(ahora, inicio)` (5 h).
- [~] **T06** Jobs: pasar a `pg-boss` con `cita_recordatorio` (D4) (3 h).
- [~] **T07** API: falta cancelar, reprogramar, confirmar y rutas de admin (agenda, config, bloqueos) (4 h).
- [~] **T08** `.ics` ✓ (añadir zona horaria y alarma); QR y página `/c/[token]` (1 h).
- [~] **T09** UI cliente: flujo ✓ básico; falta calendario de 14 días y confirmación con QR (2 h).
- [ ] **T10** UI admin: agenda por franja, configuración, bloqueos; bloque en `/panel` y PIN en la TV (5 h).
- [ ] **T11** Integración con M4/M5, E2E, carga (4 h).

### M4 · Chatbot de WhatsApp — *Integrante 2 · ≈ 42 h* · [`modulos/M4`](modulos/M4-chatbot-whatsapp.md)
- [x] Webhook de mensajes entrantes (OpenWA), FSM mínima, `procesar.ts`, bandeja simple, prueba del menú.
- [ ] **T01** Modelo `canal_whatsapp`, `conversacion_bot`, `mensaje_bot`, `evento_bot_procesado` (4 h) — **cierra D1**.
- [ ] **T02** Normalización de texto + intención con Levenshtein + fuzz (6 h).
- [~] **T03** FSM: añadir `PEDIR_CONSENTIMIENTO`, `CONFIRMAR_*`, comandos globales, contador de intentos, `HANDOFF` real, resultado de efectos (8 h).
- [~] **T04** Adaptadores Meta/OpenWA → `MensajeEntrante` y envío con *throttling* (4 h). **Verificar en la documentación de OpenWA el nombre del evento de mensaje recibido.**
- [ ] **T05** Webhook: anti-*replay* (5 min), idempotencia por `messageId`, candado por teléfono, cola `bot-procesar` (6 h).
- [~] **T06** Efectos: URL **absoluta** (`appUrl()`), posición con M2, citas con M3 (3 h).
- [ ] **T07** *Handoff*, bandeja por local, respuesta del admin (4 h) · **T08** API admin (config, métricas, flujo, probar) (3 h) · **T09** UI admin (flujo, bandeja, métricas) (3 h) · **T10** E2E con *fixtures* (1 h).

### M5 · Kiosco offline-first — *Integrante 3 · ≈ 54 h* · [`modulos/M5`](modulos/M5-kiosco-offline.md)
- [x] Página `/kiosco`, *outbox* local, registro de SW, emparejamiento por código (en memoria), `POST /kiosco/turnos`.
- [ ] **T01** Modelo `dispositivo_kiosco`, `evento_kiosco`; columnas de `turno` (4 h).
- [ ] **T02** Emparejamiento con **token de dispositivo** (hash), revocación, rotación (D3) (5 h).
- [ ] **T03** *Heartbeat* y estimación de reloj (menor RTT) (5 h).
- [~] **T04** Cliente: *outbox* en **IndexedDB**, `seq` atómico, *backoff*, UUID v7, cifrado WebCrypto no extraíble (6 h).
- [ ] **T05** `POST /kiosco/sync` y `/kiosco/turnos`: idempotencia por `clave_idem` en BD, orden, *clamp* de reloj, conflictos `REVISION`, RN03/RN05 (12 h).
- [~] **T06** PWA: SW **con alcance `/kiosco`** (D2), *precache* del shell, Background Sync, `navigator.locks` (5 h).
- [~] **T07** UI del kiosco: K0–K3 táctil, inactividad 30 s, banner offline, quitar el *slug* fijo (7 h).
- [~] **T08** Impresión 80 mm (ya hay `@page`); ticket provisional con QR `/k/…` (3 h).
- [ ] **T09** UI admin: dispositivos, cola de sincronización, resolver conflictos (5 h) · **T10** pruebas con fallos inyectados, E2E offline, manual (6 h).

### M6 · Transferencia y balanceo — *Integrante 3 · ≈ 42 h* · [`modulos/M6`](modulos/M6-transferencia-balanceo.md)
- [x] `sugerirMovimiento` (con prueba), `POST /balanceo` manual con auditoría.
- [ ] **T01** Modelo `transferencia`, `regla_balanceo`, `regla_estado`, `ejecucion_regla`; `sucesor_id`; `ventanilla.cola_original_id` (4 h).
- [~] **T02** **Rehacer la transferencia** (C9): transacción, `p_emitido`, motivo, sucesor, redirección `/t/:token`, aviso (6 h).
- [ ] **T03** Métricas en una sola consulta (5 h) · **T04** DSL de condiciones + contradicciones (6 h).
- [ ] **T05** Evaluador puro `avanzar()` (histéresis, cooldown, TTL, límite 6/h) con reloj falso (8 h).
- [ ] **T06** Ejecutor y reversión + *advisory lock* + estado persistente; **desactivar el balanceo automático actual del job o ponerlo detrás de la bandera M6 y de reglas (D5)** (6 h).
- [~] **T07** API de reglas/probar/carga/ejecuciones/confirmaciones (4 h) · **T08** modal "Transferir" en `/panel` (3 h) · **T09** UI admin de reglas (6 h) · **T10** propiedades/concurrencia/E2E (2 h).

### M7 · Analítica y SLA — *Integrante 4 · ≈ 48 h* · [`modulos/M7`](modulos/M7-analitica-sla.md)
- [x] Página `/admin/analitica` (CSAT, estados, llegadas por hora), `cumplimientoSla` (corregir D11), alerta SLA en `auditoria`, PDF simple, ruta de correo.
- [ ] **T01** Modelo `sla_cola`, `regla_alerta`, `alerta` (+ índice único parcial por `huella`), `alerta_notificacion`, `reporte_programado`, `reporte_generado` (3 h).
- [ ] **T02** `mv_turno_franja`, refresco y consultas de percentiles/mapa de calor (7 h).
- [~] **T03** SLA con **censura a la derecha** + presupuesto de error (cambiar la prueba existente) (3 h).
- [ ] **T04** Anomalías (z robusto con MAD) (5 h).
- [ ] **T05** Motor de alertas: FSM pura, deduplicación, escalamiento, canales, campana en el admin (9 h).
- [~] **T06** Reportes programados: `@react-pdf/renderer`, `nodemailer` (añadir dependencia), idempotencia por periodo (6 h).
- [ ] **T07** API de analítica/SLA/alertas/reportes (5 h) · **T08** UI de analítica real (4 h) · **T09** UI de alertas y reportes (4 h) · **T10** integración/E2E/rendimiento (5 h).

### M8 · Simulador de capacidad — *Integrante 4 · ≈ 30 h* · [`modulos/M8`](modulos/M8-simulador-capacidad.md)
- [x] **T02** `erlang.ts` estable + `minimoServidores`; pruebas básicas. [~] Añadir los vectores de prueba conocidos y el percentil/`SL(t)`.
- [x] Página con Erlang C, "Simular 4 horas" y escenarios en `localStorage`.
- [ ] **T01** Modelo `escenario_simulacion` y esquema zod (2 h).
- [~] **T03** PRNG por flujos (mulberry32/SplitMix), distribuciones log-normal/empírica, adelgazamiento (4 h).
- [~] **T04** DES con montículo de eventos, `c(t)`, abandono *real*, *no-show* (7 h).
- [ ] **T05** Monte Carlo con CRN e intervalos de confianza (5 h) · **T06** Web Worker (3 h).
- [ ] **T07** Calibración desde histórico + *backtest* (5 h) · **T08** UI completa (stepper de ventanillas, comparación, tornado) (3 h) · **T09/T10** escenarios en servidor, costos, validación DES vs Erlang (1 h + incluida en T04/T05).

---

## 6. Prototipo Figma pendiente

El MCP de Figma sigue bloqueado por el límite de llamadas del plan Starter. Pendiente:
- [ ] Actualizar el archivo (`jMAVFaO6CVSeD4jTwMCxSL`) con lo ya implementado: selector de atención preferente, panel con Verificar/No corresponde, `/l/[slug]/citas`, `/cita/[token]`, `/kiosco`, `/admin/{operacion,modulos,analitica,auditoria,bandeja,simulador}`, valoración.
- [ ] Corregir planes y precios (Gratis S/0 · Emprende S/69 · Pro S/149) y el color de marca (`#0f766e` vs `#059669`).
- [ ] Dibujar las 22 pantallas de módulos descritas en la sección 9 de cada documento y cablear las tarjetas `Modulo/M1…M8` del hub.
- Alternativa: maquetar directo en la app con los componentes de `src/components/ui/*`.

---

## 7. Orden de trabajo, reparto y cronograma restante

### 7.1 Olas

```
Ola 0  Seguridad: D1, D2, D3 (P0) · D4, D5, D6, D7, D8 (P1) · prueba de regresión de C1/C2/C4      (semana 1)
Ola 1  F0 (BD de pruebas + caracterización) → F1 pg-boss → F3 banderas → F5 emitir_turno/siguienteTurno SQL
Ola 2  M1 cierre · M3 slots atómicos · M4 tablas+FSM completa · M6 transferencia · M7 SLA/MV · M2 modelos correctos
Ola 3  M5 protocolo de sync · M6 reglas · M7 alertas · M8 DES/IC/Worker · F8 datos históricos
Ola 4  UIs · calibración/backtest · reportes · integraciones cruzadas
Ola 5  E2E, carga, revisión de seguridad, documentación, demo
```
Ruta crítica: **F0 → F5 → M1/M3/M5/M6**. Orden de recorte si falta tiempo: **M8 → M5 → M7 (reportes) → M4 (handoff)**.

### 7.2 Reparto sugerido (horas restantes aprox.)

| Integrante | Módulos | Fundaciones / núcleo / defectos | ≈ Horas |
|---|---|---|---|
| 1 · Nick | M1 (14) + M2 (48) | F0 10 · F1 10 · F5 8 · N11 8 · D8 (jobs) 4 · D9 3 | ≈ 105 |
| 2 · Jhan | M3 (38) + M4 (42) | F3 5 · F10 6 · N02 6 · N03 3 · D1 (bandeja por local) 3 · D6 3 · D7 (en M3) | ≈ 106 |
| 3 · David | M5 (54) + M6 (42) | D2 3 · D3 (en M5) · D5 (en M6) · N04 2 · N05 2 · N06 1 · N09 1 | ≈ 105 |
| 4 · Henyelrey | M7 (48) + M8 (30) | F6 8 · F8 10 · N01 3 · N08 4 · D11 (en M7) · D12 2 · D13 (en M8) | ≈ 105 |

### 7.3 Cronograma (supuesto: 6 semanas desde el 13/10/2026; ajustar a la fecha real de entrega)

| Semana | Entregables verificables |
|---|---|
| **S1** (13–19/10) | Docs publicados; ramas/PR; **D1, D2, D3** corregidos; pruebas de regresión de C1/C2/C4; `.env.example`; F0 con BD de pruebas |
| **S2** (20–26/10) | F1 (`pg-boss`), F3, F5 SQL; D4–D8; `reglas.ts` puros con pruebas en M1/M2/M3/M4/M6/M7/M8; F8 histórico |
| **S3** (27/10–2/11) | M3 reservas atómicas; M4 con tablas; M6 transferencia nueva; M7 SLA correcto; M5 protocolo de sync |
| **S4** (3–9/11) | UIs de módulos; M6 reglas; M7 alertas; M8 DES con IC; N01–N09 |
| **S5** (10–16/11) | Integraciones cruzadas; E2E 7–12; k6; revisión de seguridad |
| **S6** (17–23/11) | Congelamiento, manual, video, ensayo de demo, `v1.0` |

---

## 8. Cómo verificar cada avance

```bash
B=http://localhost:3000/api/v1

# C1 (corregido) — un cliente NO puede declararse EMERGENCIA (esperado: M1_CATEGORIA_NO_DISPONIBLE)
curl -s -X POST $B/public/turnos -H 'Content-Type: application/json' \
  -d '{"colaId":1,"nombre":"Prueba","categoriaCodigo":"EMERGENCIA"}'

# M1 — el adulto mayor pasa delante de un general (esperado: posición 1)
curl -s -X POST $B/public/turnos -H 'Content-Type: application/json' \
  -d '{"colaId":1,"nombre":"AM","categoriaCodigo":"ADULTO_MAYOR"}'

# C3 (corregido) — las rutas viejas ya no existen (esperado: 405)
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $B/operacion

# D2 — el SW no debe cachear la API: tras visitar /kiosco, en DevTools → Application → Cache Storage no debe haber /api/*
# D1 — con dos locales, la bandeja del local B no debe mostrar mensajes del local A
# D8 — select count(*) from job_interno;  (hoy crece 1 por ciclo de 30 s; debe dejar de existir)

npm run typecheck && npm run lint && npm test
```
Cada tarea debe incluir sus pruebas (sección 12 de cada documento de módulo) y su escenario Gherkin (sección 14).

---

## 9. Definición de terminado y checklist de entrega

**Por tarea:** código + pruebas + migración aditiva y documentada + permisos y bandera de módulo verificados + todos los *queries* filtran por `localId` + log/auditoría + entrada en `docs/` + capturas si hay UI + revisión de otra persona ([`PLAN_INTEGRAL.md` §8.4 y §14](PLAN_INTEGRAL.md)).

**Para la entrega final**
- [ ] D1–D8 corregidos con prueba; C1, C2, C4 con prueba de regresión.
- [ ] F0, F1, F3, F5 y F8 completas; CI verde y obligatorio en `main`.
- [ ] Los 8 módulos cumplen los criterios de aceptación de su documento (sección 14) y los 12 escenarios E2E de [`PLAN_INTEGRAL.md` §8.3](PLAN_INTEGRAL.md).
- [ ] Módulos apagados ⇒ comportamiento idéntico al original (pruebas de caracterización en verde); el balanceo y los avisos automáticos **no** actúan sobre locales sin el módulo.
- [ ] Prueba de privacidad: ninguna pantalla pública, ticket ni WhatsApp muestra la categoría de prioridad; datos personales de citas cifrados y purgados a los 90 días.
- [ ] Prueba de aislamiento multi-local en cada endpoint nuevo (incluido el bot y el kiosco).
- [ ] Informe técnico, manual de usuario, manual de instalación, presentación y video ([`PLAN_INTEGRAL.md` §13](PLAN_INTEGRAL.md)).
- [ ] Prototipo Figma actualizado y alineado con la app.
- [ ] Release `v1.0` etiquetado.

---

## Actualización 13/10/2026 — rama `feat/cierre-integral` (Claude Code)

**Hecho:** fundaciones F0–F8 (jobs con reclamo atómico, banderas por plan/local, auditoría con actor, `emitir_turno`/`siguiente_turno`/`posicion_turno` en SQL, rate limit persistente, logger y `/api/metrics`, CSP), M1–M8 completos en backend + API (~95 rutas), D1–D16 corregidos, 85 pruebas unitarias + 27 de integración (BD real) en verde, CI con PostgreSQL, `.env.example`.
UI nueva: hub de módulos, Prioridades, Predicción, Citas (admin y cliente `/l/[slug]/citas`, `/c/[token]`), Chatbot, Kiosco (admin + app offline con IndexedDB y SW en `/kiosco`), Balanceo, Analítica/SLA/alertas/reportes, Simulador (Worker), panel con transferir/explicación/PIN, historial del operador, TV con PIN, mi turno con rango y aviso.

**Falta:**
- Pantallas de `/admin/auditoria` (filtros/CSV), `/admin/planes` y `/admin/jobs` (la API ya existe: `/api/v1/auditoria`, `/planes`, `/jobs`).
- `prisma/seed.ts` (sembrar `plan_modulo`, `local_modulo`, categorías) y `prisma/seed-historico.ts` (F8).
- `npm run lint` y `npm run build` completos; prueba manual en navegador; Playwright E2E y k6.
- Documentación `docs/ARQUITECTURA.md` (decisión: planificador propio en vez de pg-boss, bus en memoria con una instancia, PDF con pdf-lib).
- Figma (bloqueado por límite del MCP) y registrar de nuevo el webhook de OpenWA para recibir `message.received`.
