# M5 · Kiosco de autoservicio offline-first

**Responsable:** Integrante 3 · **Estimación:** 72 h · **Complejidad:** ●●●●● · **Plan:** PRO (hasta 3 dispositivos)
**Depende de:** F0, F1 (jobs), F2 (bus), F3 (banderas), F5 (`emitir_turno` con fecha de emisión y origen), F7 (rate limit persistente) · **Se integra con:** M1 (botones de prioridad), M3 (check-in de citas), M7 (alertas), M2 (espera estimada cuando hay conexión)
**Pantallas Figma previstas:** M5a Inicio ("Toque para sacar turno") · M5b Elegir servicio · M5c Teclado de DNI e impresión del ticket · M5d Dispositivos y cola de sincronización (admin)

---

## 1. Resumen y objetivo

Un **tótem táctil** en la sala de espera permite sacar turno sin celular. La parte difícil: **debe seguir emitiendo tickets aunque se corte la conexión** (Wi‑Fi del local, caída de internet, reinicio del servidor) y, al volver,
**sincronizar sin duplicar turnos ni alterar el orden de llegada**.

M5 es el módulo de mayor complejidad: **PWA (Service Worker + IndexedDB)**, **sincronización idempotente**, **corrección de reloj**, **resolución de conflictos**, **emparejamiento seguro de dispositivos** y **modo kiosco**.

### 1.1 Escenarios que cubre
| Escenario | Qué ocurre |
|---|---|
| Se cae el Wi‑Fi del kiosco; el servidor sigue vivo | El kiosco emite tickets **provisionales** y sincroniza al volver |
| Se cae internet del local (servidor en la nube) | Operadores y TV también sufren el corte, pero el kiosco **no pierde a los clientes** que llegan |
| La respuesta del servidor se pierde justo después de confirmar | El reintento con la misma clave **no duplica** el turno |
| El kiosco tiene el reloj adelantado/atrasado | Se corrige con el desfase medido en el *heartbeat* |
| Se reinicia o se corta la luz del kiosco | La cola local persiste en IndexedDB y se retoma |

## 2. Alcance

**Incluye:** app `/kiosco` instalable (PWA, pantalla completa, vertical); selección de servicio (y de categoría si M1 activo); captura opcional de DNI/celular con consentimiento; emisión **online** y **offline**;
ticket impreso con QR; *outbox* local; sincronización por lotes; corrección de reloj; detección de duplicados y conflictos; emparejamiento y revocación de dispositivos; *heartbeat* y estado en vivo en el admin; menú de mantenimiento oculto; check-in de citas (M3) con QR/código.

**No incluye (v1):** servidor local on-premise (modo "isla"), pagos, múltiples idiomas, voz, impresión ESC/POS vía WebUSB (queda como **v2 opcional**, v1 usa `window.print()` con *kiosk printing*).

## 3. Actores e historias

| Actor | Historia |
|---|---|
| Cliente | Toco la pantalla, elijo el servicio y recibo mi ticket impreso en menos de 10 s |
| Cliente | Aunque no haya internet, recibo mi ticket y me atienden en el orden en que llegué |
| Admin | Registro un kiosco con un código, lo veo en línea/sin conexión y puedo revocarlo |
| Admin | Reviso los turnos que quedaron "en revisión" tras un corte y decido qué hacer |
| Operador | Veo en mi panel el turno **A-045 (K1-0007)** para saber a qué ticket de papel corresponde |
| Técnico | Entro al menú de mantenimiento con gesto + PIN para reimprimir, forzar sincronización o desemparejar |

## 4. Requisitos

**Funcionales**
- **RF-M5-01** El admin crea un dispositivo y obtiene un **código de emparejamiento** (6 dígitos, válido 10 min); el kiosco lo canjea por un **token** de dispositivo.
- **RF-M5-02** El kiosco muestra únicamente las colas activas/abiertas asignadas a su dispositivo y, con M1, las categorías visibles para el cliente.
- **RF-M5-03** Emisión **online**: `POST /kiosco/turnos` con clave de idempotencia; imprime ticket con el código definitivo y QR a `/t/:token`.
- **RF-M5-04** Emisión **offline**: genera código provisional `K{n}-{seq}`, guarda el evento en el *outbox* (IndexedDB) y lo imprime con QR a `/k/:dispositivo/:fecha/:seq`.
- **RF-M5-05** Sincronización automática al reconectar, por lotes de hasta 100 eventos, con reintentos y *backoff*.
- **RF-M5-06** El servidor aplica los eventos **en orden**, con **idempotencia por clave**, asignando `emitido_at` corregido por el desfase de reloj.
- **RF-M5-07** Conflictos (cola cerrada, límite de plan, día anterior, reloj inconsistente) quedan en estado `REVISION` y el admin los resuelve.
- **RF-M5-08** *Heartbeat* cada 20 s con estado, pendientes, versión e impresora; el admin ve el estado en vivo.
- **RF-M5-09** Modo kiosco: pantalla completa, sin menú contextual ni selección, retorno a la pantalla de inicio tras 30 s de inactividad (con cuenta regresiva a los 20 s).
- **RF-M5-10** Menú de mantenimiento (5 toques en la esquina + PIN del dispositivo): reimprimir último ticket, forzar sincronización, ver diagnóstico, desemparejar.
- **RF-M5-11** Check-in de **citas** (M3) escaneando el QR o tecleando el código de 6 caracteres.
- **RF-M5-12** Operadores y TV muestran el código provisional entre paréntesis junto al definitivo.

**Reglas de negocio**
- **RN-M5-01** Clave de idempotencia = UUID v7 generado **al pulsar "Imprimir"**, antes de cualquier red; se reutiliza en todos los reintentos y en el *fallback* offline.
- **RN-M5-02** La asignación del `seq` local, el guardado del evento y el marcado "pendiente de impresión" ocurren en **una sola transacción de IndexedDB**.
- **RN-M5-03** `emitido_at = ts_dispositivo + offset`, acotado a `[último heartbeat − 5 s, ahora]` y **monótono** dentro del dispositivo (cada evento ≥ anterior + 1 ms).
- **RN-M5-04** Evento con `fecha` local anterior a hoy ⇒ `REVISION` (`FECHA_ANTERIOR`); más antiguo que `ventanaOfflineMaxHoras` (def. 12) ⇒ `REVISION`.
- **RN-M5-05** Si el cliente ya tiene un turno activo en la cola (RN03) ⇒ el evento se marca `DUPLICADO` y se enlaza al turno existente (no se crea otro).
- **RN-M5-06** Límite del plan (RN05) alcanzado ⇒ `REVISION` (`LIMITE_PLAN`); no se descarta en silencio.
- **RN-M5-07** El desfase de reloj > 2 min genera aviso en el admin; un cambio de desfase > 5 min entre *heartbeats* marca el lote como `RELOJ_INCONSISTENTE`.
- **RN-M5-08** Los datos personales capturados offline se **cifran** en IndexedDB (clave no extraíble) y se borran apenas se confirma la sincronización.
- **RN-M5-09** Un dispositivo revocado deja de aceptar emisión y muestra "Dispositivo no autorizado"; sus eventos pendientes se conservan 24 h para revisión del admin.

**No funcionales**
- **RNF-M5-01** Emisión offline en < 1.5 s hasta iniciar la impresión.
- **RNF-M5-02** Sincronizar 500 eventos acumulados en < 10 s.
- **RNF-M5-03** 0 duplicados y 0 pérdidas en 1 000 corridas de inyección de fallos (cortes, respuestas perdidas, reinicios).
- **RNF-M5-04** Objetivos táctiles ≥ 64 px, tipografía ≥ 28 px, contraste AA/AAA; funciona en Chrome/Edge 120+ y Android WebView.

## 5. Diseño de datos

```prisma
enum EstadoEventoKiosco { PENDIENTE APLICADO DUPLICADO REVISION RECHAZADO }

model DispositivoKiosco {
  id                  String    @id @default(uuid())
  localId             Int       @map("local_id")
  numero              Int                                   // 1,2,3… → prefijo K1, K2
  nombre              String
  colaIds             Int[]     @map("cola_ids")
  tokenHash           String?   @map("token_hash")            // sha256 del token; null hasta emparejar
  codigoEmparejHash   String?   @map("codigo_emparej_hash")
  codigoEmparejExpira DateTime? @map("codigo_emparej_expira")
  activo              Boolean   @default(true)
  versionApp          String?   @map("version_app")
  ultimoHeartbeatAt   DateTime? @map("ultimo_heartbeat_at")
  offsetRelojMs       Int       @default(0) @map("offset_reloj_ms")
  pendientesReportados Int      @default(0) @map("pendientes_reportados")
  impresora           String?
  configVersion       Int       @default(1) @map("config_version")
  createdAt           DateTime  @default(now()) @map("created_at")
  eventos             EventoKiosco[]
  @@unique([localId, numero])
  @@map("dispositivo_kiosco")
}

model EventoKiosco {
  id               BigInt             @id @default(autoincrement())
  dispositivoId    String             @map("dispositivo_id")
  claveIdem        String             @unique @map("clave_idem")        // UUID v7
  seq              Int
  tipo             String                                              // EMITIR_TURNO | CHECKIN_CITA
  payload          Json                                                // sin PII en claro: el teléfono/DNI van cifrados
  tsDispositivo    DateTime           @map("ts_dispositivo")
  offsetMsAlEmitir Int                @map("offset_ms_al_emitir")
  tsCorregido      DateTime?          @map("ts_corregido")
  recibidoAt       DateTime           @default(now()) @map("recibido_at")
  estado           EstadoEventoKiosco @default(PENDIENTE)
  motivo           String?                                              // FECHA_ANTERIOR | LIMITE_PLAN | COLA_INACTIVA | RELOJ_INCONSISTENTE | …
  turnoId          Int?               @map("turno_id")
  resueltoPor      Int?               @map("resuelto_por")
  resueltoAt       DateTime?          @map("resuelto_at")
  dispositivo      DispositivoKiosco  @relation(fields: [dispositivoId], references: [id], onDelete: Cascade)
  @@index([dispositivoId, seq])
  @@index([estado, recibidoAt])
  @@map("evento_kiosco")
}
// Turno (F5): origenDispositivoId String?, codigoProvisional String?; CanalTurno += KIOSCO
```

**Estructuras en el navegador (IndexedDB `turnoya-kiosco`, vía `idb`):**
| Store | Clave | Contenido |
|---|---|---|
| `meta` | `"estado"` | `{ dispositivoId, tokenCifrado, seqPorFecha: { "2026-10-20": 7 }, offsetMs, rttMin, ultimaSync }` |
| `outbox` | `claveIdem` | `{ seq, tipo, tsDispositivo, offsetMsAlEmitir, payloadCifrado, intentos, proximoIntentoAt }` |
| `impresiones` | `claveIdem` | `{ codigoProvisional, estado: "PENDIENTE" \| "IMPRESO" \| "ERROR" }` |
| `config` | `"actual"` | Configuración versionada (colas, categorías, textos, tiempos) |

## 6. Diseño de la solución

### 6.1 Máquina de estados de conexión (cliente)
```
        heartbeat OK, RTT<2 s                  falla de red / timeout / 5xx
ONLINE ─────────────────────────────► DEGRADADO ──────(3 fallos o 60 s)──────► OFFLINE
  ▲                                                                           │ heartbeat OK
  └────────────── outbox vacío ◄──── SINCRONIZANDO ◄──────────────────────────┘
```
- ONLINE: emite por `POST /kiosco/turnos` (timeout 4 s).
- DEGRADADO: intenta online con timeout corto y **cae a offline con la misma clave** si falla.
- OFFLINE: emite solo a *outbox*; el detector de red combina `navigator.onLine`, el resultado del *heartbeat* y el fallo de peticiones (no se fía de `onLine` solo).
- SINCRONIZANDO: vacía el *outbox* por lotes; el kiosco **sigue permitiendo emitir** durante la sincronización (los nuevos eventos van al final).

### 6.2 Emisión (flujo de pulsación a ticket)
```
usuario toca "Imprimir":
   1. claveIdem = uuidv7()
   2. tx IndexedDB { seq = ++seqPorFecha[hoy]; guardar outbox{claveIdem, seq, ts, offset, payloadCifrado}; impresiones[claveIdem] = PENDIENTE }
   3. si estado ∈ {ONLINE, DEGRADADO}: POST /kiosco/turnos (claveIdem)  → respuesta con código definitivo y token
         éxito: imprimir ticket definitivo; borrar de outbox; impresiones = IMPRESO
         fallo: continuar a 4
   4. imprimir ticket PROVISIONAL "K1-0007" con QR a /k/:dispositivo/:fecha/:seq; impresiones = IMPRESO(provisional)
   5. disparar sincronización (Background Sync + temporizador)
```
El paso 2 antes que cualquier red garantiza que **nunca se pierde** un turno aunque se corte la luz.

### 6.3 Sincronización (cliente)
```
mientras outbox no vacío y token válido:
    adquirir candado navigator.locks("sync")                        // una sola pestaña sincroniza
    lote = hasta 100 eventos ordenados por seq con proximoIntentoAt ≤ ahora
    POST /kiosco/sync { dispositivoId, lote, relojDispositivo }
    por cada resultado:  APLICADO | DUPLICADO → borrar de outbox y de impresiones (si ya impreso)
                         REVISION | RECHAZADO → borrar de outbox (el servidor lo conserva) y registrar en el diagnóstico
    si falla el transporte: intentos++, proximoIntentoAt = ahora + min(60 s, 2^intentos s) + jitter(0–1 s)
```
Entrega **al menos una vez** + operación **idempotente** = efecto **exactamente una vez**.

### 6.4 Sincronización (servidor)
```
POST /kiosco/sync (Bearer token del dispositivo):
  1. autenticar dispositivo (sha256(token) = token_hash, activo)         → 401 M5_DISPOSITIVO_NO_AUTORIZADO
  2. rate limit por dispositivo (60 req/min)
  3. para cada evento en orden de seq (cada uno en su propia transacción):
       a. INSERT INTO evento_kiosco(... clave_idem ...) ON CONFLICT (clave_idem) DO NOTHING RETURNING id
            si no inserta ⇒ leer el existente y devolver su resultado (DUPLICADO) — idempotencia
       b. ts_corr = tsDispositivo + offsetMsAlEmitir
          clamp: max(ts_corr, ultimo_hb − 5 s) y min(ts_corr, ahora); monótono: ts_corr = max(ts_corr, previo + 1 ms)
       c. validar: fecha local(ts_corr) = hoy · antigüedad ≤ ventanaOffline · desfase coherente · cola activa · límite de plan
            si falla ⇒ estado REVISION con `motivo` y continuar con el siguiente
       d. RN03: si el cliente ya tiene turno activo en la cola ⇒ DUPLICADO enlazado al existente
       e. emitir_turno(cola, cliente, 'KIOSCO', token, fecha, categoria, ts_corr, origen = dispositivo/seq/codigoProvisional)
       f. evento → APLICADO con turno_id
  4. responder { resultados[], ackSeq, serverTime }, publicar kiosco:evento y cola:actualizada
```
**Orden:** el turno entra a la fila por `emitido_at` (y `clave_orden` de M1), **no** por número. Los números (`A-045`) se asignan al sincronizar y pueden no ser cronológicos respecto de otros turnos del mismo intervalo: es una decisión consciente; el orden de atención manda.

### 6.5 Corrección de reloj (estimación estilo NTP)
```
heartbeat: t0 = Date.now()  → POST → servidor responde ts_servidor → t1 = Date.now()
rtt = t1 − t0 ;  offset_muestra = ts_servidor − (t0 + rtt/2)
conservar las últimas 5 muestras y usar la de menor rtt  →  offsetMs
al emitir un evento se guarda offsetMsAlEmitir = offsetMs vigente
```
Aviso si `|offsetMs| > 120 000`; si el offset cambia > 300 000 entre dos *heartbeats* (reloj reajustado), los eventos del tramo se marcan `RELOJ_INCONSISTENTE`.

### 6.6 Emparejamiento y seguridad del dispositivo
```
admin: POST /kiosco/dispositivos → crea fila + código de 6 dígitos (TTL 10 min, se guarda su sha256)
kiosco: POST /kiosco/emparejar { codigo } → valida y consume el código → genera token (32 bytes aleatorios, base64url) → guarda sha256(token) → devuelve { dispositivoId, token, config }
kiosco: guarda el token CIFRADO con una CryptoKey no extraíble (WebCrypto) en IndexedDB
revocar: activo=false ⇒ 401 en cualquier llamada ⇒ pantalla "Dispositivo no autorizado"
rotar token: POST /kiosco/dispositivos/:id/rotar → el kiosco recibe el nuevo token en el siguiente heartbeat
```
Alcance del token: **solo** `/kiosco/*` (no sirve para la API de staff).

### 6.7 PWA y modo kiosco
- **Rutas:** `/kiosco` (app), `/kiosco/emparejar`, manifiesto propio (`display: fullscreen`, `orientation: portrait`, `start_url: /kiosco`).
- **Service Worker** en `/kiosco/sw.js` (alcance `/kiosco`): *precache* del *shell* y estáticos versionados; `stale-while-revalidate` para `GET /api/v1/kiosco/config`; **nunca** cachea POST. Estrategia de actualización: nueva versión se activa solo cuando el *outbox* está vacío.
- **Background Sync** (`sync` event, Chromium) + temporizador de respaldo en la página.
- `navigator.storage.persist()` y `navigator.wakeLock` (pantalla siempre encendida).
- **Chrome en modo kiosco (documentar en el manual):** `chrome --kiosk --kiosk-printing --disable-pinch --overscroll-history-navigation=0 https://<host>/kiosco`.
- **Impresión v1:** diseño de ticket de 80 mm con CSS (`@page { size: 80mm auto; margin: 0 }`) + `window.print()` (silencioso con `--kiosk-printing`). **v2 opcional:** ESC/POS por WebUSB/Web Serial. Si falla la impresión: se muestra el código en pantalla grande y un aviso para pedir ayuda.

### 6.8 Check-in de citas (M3)
Pantalla "Tengo una cita": cámara (`BarcodeDetector` si existe) para escanear el QR o teclado de 6 caracteres. Llama a `POST /kiosco/citas/checkin` (sin PIN de presencia: estar frente al kiosco ya prueba presencia). Offline: el check-in se **encola** como evento `CHECKIN_CITA` y el kiosco imprime un ticket provisional.

### 6.9 Pantallas del kiosco (diseño 1080×1920)
| ID | Pantalla | Detalle |
|---|---|---|
| K0 | Inicio | "Toque para sacar turno", hora, horario, indicador discreto de conexión; botón "Tengo una cita" |
| K1 | Servicio | Tarjetas grandes por cola (con espera estimada **solo online**) |
| K1b | Tipo de atención | Solo con M1 activo: General / Adulto mayor / Gestante / Discapacidad |
| K2 | Datos (opcional) | Teclado numérico grande (DNI/celular), texto de consentimiento, botón "Omitir" |
| K3 | Impresión y gracias | Código enorme, QR, mensaje; vuelve a K0 a los 8 s |
| K9 | Mantenimiento | Tras gesto + PIN: estado, pendientes, reimprimir, sincronizar, diagnóstico, desemparejar |
| — | Banner offline | Franja amarilla: "Sin conexión: tu ticket es provisional; tu número definitivo aparecerá en la pantalla" |

## 7. API

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/kiosco/dispositivos` | ADMIN+ | Crea dispositivo; devuelve código de emparejamiento |
| GET/PATCH/DELETE | `/kiosco/dispositivos[/:id]` | ADMIN+ | Lista/edita (nombre, colas)/revoca |
| POST | `/kiosco/dispositivos/:id/rotar` | ADMIN+ | Rota el token |
| POST | `/kiosco/emparejar` | público (rate limit) | Canjea el código por token |
| GET | `/kiosco/config` | Bearer dispositivo | Configuración versionada |
| POST | `/kiosco/heartbeat` | Bearer dispositivo | `{ t0, estado, pendientes, version, impresora }` ⇒ `{ serverTime, configVersion }` |
| POST | `/kiosco/turnos` | Bearer dispositivo | Emisión online con `claveIdem` |
| POST | `/kiosco/sync` | Bearer dispositivo | Lote de eventos (§6.4) |
| POST | `/kiosco/citas/checkin` | Bearer dispositivo | Check-in de cita (M3) |
| GET | `/kiosco/eventos?estado&dispositivo&cursor` | ADMIN+ | Cola de sincronización |
| POST | `/kiosco/eventos/:id/resolver` | ADMIN+ | `{ accion: "EMITIR_AHORA" \| "DESCARTAR" }` |
| GET | `/public/k/:dispositivo/:fecha/:seq` | público | Resuelve el QR provisional ⇒ `/t/:token` (o "aún registrándose") |

**Ejemplo `POST /kiosco/sync` (respuesta)**
```json
{ "ok": true, "data": {
  "resultados": [
    { "claveIdem": "0192…", "estado": "APLICADO",  "turno": { "codigo": "A-045", "token": "H4Q7…", "posicion": 6 } },
    { "claveIdem": "0192…", "estado": "DUPLICADO", "turno": { "codigo": "A-046", "token": "P8M2…" } },
    { "claveIdem": "0192…", "estado": "REVISION",  "motivo": "COLA_INACTIVA" } ],
  "ackSeq": 9, "serverTime": "2026-10-20T15:02:11.500Z" } }
```
**Errores:** `M5_DISPOSITIVO_NO_AUTORIZADO` (401), `M5_CODIGO_INVALIDO` (403), `M5_CODIGO_EXPIRADO` (410), `M5_LOTE_DEMASIADO_GRANDE` (413), `M5_EVENTO_INVALIDO` (422), `M5_LIMITE_DISPOSITIVOS` (402), `MODULO_NO_DISPONIBLE` (403).

## 8. Jobs y eventos
| Job | Cron | Qué hace |
|---|---|---|
| `kiosco-vigilancia` | cada 1 min | Marca "sin conexión" si no hay *heartbeat* en 75 s y publica `kiosco:estado` (M7 genera alerta `KIOSCO_OFFLINE`) |
| `kiosco-limpieza` | `0 4 * * *` | Elimina eventos APLICADO/DUPLICADO > 30 días y datos personales de REVISION > 7 días |
Eventos: `kiosco:estado`, `kiosco:evento` (nuevos conflictos para el admin).

## 9. UI (admin)
`/admin/modulos/kiosco`: **Dispositivos** (tarjeta por kiosco: ● En línea / ○ Sin conexión / ⚠ Reloj desfasado, versión, última sincronización, pendientes, impresora, "Revocar", "Rotar token"), **Cola de sincronización** (tabla con filtro por estado; en `REVISION`: botones "Emitir ahora" / "Descartar"), **Emparejar** (código y QR con cuenta regresiva), **Configuración** (tiempos de inactividad, ventana offline, textos).
Operador/TV: etiqueta secundaria con el código provisional (RF-M5-12). Estados vacíos: sin dispositivos, sin conflictos.

## 10. Integración con el núcleo
| Archivo | Cambio |
|---|---|
| `emitir_turno()` (F5) | Parámetros `p_emitido` y `p_origen` (`dispositivo`, `seq`, `codigo_provisional`) |
| `src/lib/turnos.ts` · `emitirTurno` | Canal `KIOSCO`; versión interna reutilizable por el *sync* con fecha de emisión |
| `snapshotLocal` / TV / panel | Mostrar `codigoProvisional` si existe |
| `src/lib/realtime.ts` | Eventos `kiosco:*` |
| M1 | Categorías visibles en K1b |
| M3 | Check-in de citas |
| M7 | Alerta `KIOSCO_OFFLINE` |

## 11. Seguridad y privacidad
- Token de dispositivo de alta entropía, guardado solo como hash; alcance limitado a `/kiosco/*`; rotación y revocación; rate limit por dispositivo.
- Código de emparejamiento de un solo uso, TTL 10 min, comparación en tiempo constante.
- PII offline cifrada con clave WebCrypto **no extraíble**; se purga al confirmar la sincronización; nunca en logs ni en el *service worker cache*.
- Menú de mantenimiento protegido con PIN por dispositivo; sin acceso a otras rutas (el navegador corre en modo kiosco).
- El consentimiento se muestra en pantalla y se guarda con el evento (`consentimientoAt` = `tsDispositivo`).

## 12. Pruebas
**Unitarias (lógica pura del cliente, `fake-indexeddb`):** asignación atómica de `seq`; *backoff* con *jitter* acotado; estimación de *offset* (elige la muestra de menor RTT); máquina de estados de conexión; generación de UUID v7 (orden temporal); cifrado/descifrado del payload.
**Unitarias (servidor):** *clamp* y monotonía de `ts_corr`; clasificación de conflictos; idempotencia por `clave_idem`.
**Propiedades / inyección de fallos (`fast-check` + servidor simulado):** para cualquier secuencia de {emitir, cortar red, perder respuesta, reiniciar, reintentar} ⇒ **cada pulsación genera exactamente un turno** y el **orden** relativo por `emitido_at` coincide con el de pulsación.
**Integración (BD real):** 2 dispositivos sincronizando a la vez la misma cola (numeración única); lote repetido 3 veces ⇒ mismos resultados; token revocado a mitad del lote; límite de plan con lote de 120; evento de ayer ⇒ `REVISION`; reloj +2 h adelantado ⇒ *clamp* a `ahora`.
**E2E (Playwright):** `context.setOffline(true)` ⇒ emitir 3 tickets ⇒ `setOffline(false)` ⇒ se sincronizan y aparecen en el panel del operador con el código provisional; recarga de la página con eventos pendientes; dos pestañas (candado `navigator.locks`); actualización del *service worker* con *outbox* no vacío no interrumpe.
**Carga:** 500 eventos acumulados sincronizados en < 10 s; 3 kioscos con emisión continua.
**Accesibilidad:** tamaños táctiles y contraste verificados con axe y revisión manual en un monitor táctil real.

## 13. Observabilidad
`m5_eventos_total{estado}`, `m5_sync_lote_ms`, `m5_pendientes{dispositivo}`, `m5_offset_ms{dispositivo}`, `m5_dispositivos_en_linea`, `m5_revision_total{motivo}`. Log por lote: `dispositivo`, `n`, `aplicados`, `duplicados`, `revision`, `duracion`. Diagnóstico exportable desde el menú K9.

## 14. Criterios de aceptación
```gherkin
Escenario: Emisión sin conexión
  Dado un kiosco emparejado y sin conexión
  Cuando un cliente elige "Medicina General" e imprime
  Entonces recibe un ticket provisional "K1-0001" con QR
  Y el evento queda guardado localmente

Escenario: Sincronización sin duplicados
  Dado 3 eventos pendientes en el kiosco
  Cuando vuelve la conexión y la respuesta de la primera sincronización se pierde
  Entonces el reintento no crea turnos duplicados
  Y los 3 turnos aparecen en la fila en el orden en que se imprimieron

Escenario: Reloj desfasado
  Dado un kiosco con el reloj 2 horas adelantado
  Cuando sincroniza eventos
  Entonces ningún turno queda con hora futura y el admin ve la alerta de reloj

Escenario: Conflicto
  Dado un evento de un día anterior
  Cuando se sincroniza
  Entonces queda en "Revisión" y el admin puede descartarlo

Escenario: Revocación
  Cuando el admin revoca el dispositivo
  Entonces el kiosco muestra "Dispositivo no autorizado" y deja de emitir
```

## 15. Riesgos
| Riesgo | Mitigación |
|---|---|
| Pérdida de turnos por corte de luz | Transacción IndexedDB **antes** de imprimir; reimpresión automática si quedó `PENDIENTE` |
| Duplicados por reintentos | Clave de idempotencia fija por pulsación + `ON CONFLICT` |
| Orden alterado por relojes | Corrección con desfase NTP-simple, *clamp* y monotonía; orden por `emitido_at` |
| Navegador en el kiosco purga el almacenamiento | `storage.persist()`, instalación PWA, diagnóstico y alerta si el *outbox* se vacía sin ACK |
| Impresión silenciosa depende de la configuración del SO | Manual de instalación; modo "mostrar código en pantalla" como respaldo |
| Complejidad (es el módulo más grande) | Empezar por la lógica pura y el protocolo de *sync*; UI y PWA después; orden de recorte §11 del plan (v2: ESC/POS, check-in de citas) |

## 16. Plan de tareas
| ID | Tarea | Horas | Estado |
|---|---|---|---|
| M5-T01 | Modelo y migración (dispositivos, eventos, columnas de `turno`, canal `KIOSCO`) | 4 | [ ] |
| M5-T02 | Emparejamiento, token de dispositivo, revocación y rotación | 6 | [ ] |
| M5-T03 | *Heartbeat*, estimación de reloj y estado en vivo | 5 | [ ] |
| M5-T04 | Lógica pura del cliente: *outbox*, `seq` atómico, *backoff*, estado de conexión, UUID v7, cifrado | 8 | [ ] |
| M5-T05 | `POST /kiosco/sync` y `/kiosco/turnos`: idempotencia, orden, *clamp*, conflictos, RN03/RN05 | 12 | [ ] |
| M5-T06 | PWA: Service Worker, *precache*, manifiesto, IndexedDB, `storage.persist`, Background Sync, candado de pestañas | 8 | [ ] |
| M5-T07 | UI del kiosco (K0–K3, K9, banner offline, inactividad) | 10 | [ ] |
| M5-T08 | Impresión (CSS 80 mm, `kiosk-printing`, ticket provisional con QR `/k/…`) | 4 | [ ] |
| M5-T09 | UI admin: dispositivos, cola de sincronización, resolver conflictos, emparejar | 7 | [ ] |
| M5-T10 | Pruebas (propiedades con fallos inyectados, concurrencia, Playwright offline), manual de instalación y documentación | 8 | [ ] |
| **Total** | | **72** | |
