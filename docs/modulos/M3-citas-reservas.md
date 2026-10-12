# M3 · Citas y reservas con check-in por QR

**Responsable:** Integrante 2 · **Estimación:** 64 h · **Complejidad:** ●●●●○ · **Plan:** EMPRENDE (1 cola) / PRO (todas)
**Depende de:** F0, F1 (jobs), F3 (banderas), F5 (`emitir_turno` con origen/fecha), **M1** (categoría `CITA`), N05 (`horario_local`) · **Se integra con:** M4 (bot), M5 (kiosco)
**Pantallas Figma previstas:** M3a Cliente: agendar (calendario y horarios) · M3b Cliente: confirmación con QR y check-in · M3c Admin: agenda del día

---

## 1. Resumen y objetivo

TurnoYa resuelve la fila **del día**. M3 permite **reservar por adelantado** un horario con el servicio y, al llegar, convertir la cita en un turno de la fila
virtual con una ventaja equilibrada, sin permitir sobrecupo ni dañar a quienes llegan sin cita.

Problemas técnicos centrales: **(1) no sobrevender cupos bajo concurrencia, (2) zonas horarias, (3) ventana de check-in justa, (4) recordatorios idempotentes,
(5) reincidencia de inasistencias (no-show), (6) comprobar presencia física al hacer check-in.**

## 2. Alcance

**Incluye:** configuración de agenda por cola; generación perezosa de *slots* con capacidad; reserva, cancelación y reprogramación atómicas; idempotencia;
check-in con PIN de presencia (QR + código corto); creación del turno con prioridad de cita; recordatorios T−24 h y T−2 h; no-show y bloqueo por reincidencia;
bloqueos de agenda (feriados); agenda del día para admin/operador; archivo `.ics`; hooks para el bot (M4) y el kiosco (M5).

**No incluye (v1):** pagos o depósitos, profesionales/agendas individuales por médico, citas recurrentes, listas de espera automáticas para cupos liberados (stretch).

## 3. Actores e historias

| Actor | Historia |
|---|---|
| Cliente | Reservo un horario desde el celular y recibo un QR para identificarme al llegar |
| Cliente | Puedo cancelar o cambiar mi cita sin llamar por teléfono |
| Cliente | Al llegar escaneo el QR y entro a la fila con mi ventaja de cita |
| Admin | Defino horarios, duración, cupos y bloqueo feriados; veo la agenda y cancelo/muevo citas |
| Operador | Veo quién tiene cita en los próximos 60 min |
| Sistema | Envío recordatorios, marco inasistencias y bloqueo a reincidentes |

## 4. Requisitos

**Funcionales**
- **RF-M3-01** El admin configura por cola: duración del slot, cuota de cupos para citas (% de ventanillas), anticipación mínima/máxima, ventana de check-in, gracia, máx. de no-shows y días de bloqueo.
- **RF-M3-02** El sistema genera *slots* a partir de `horario_local` menos `bloqueo_agenda`; capacidad = `max(1, floor(ventanillas_cola × cuota%))` (o valor fijo).
- **RF-M3-03** El cliente ve disponibilidad por día (14 días) y por franja, y reserva con nombre, celular y consentimiento.
- **RF-M3-04** La reserva es atómica: nunca más de `capacidad` reservas por slot, aunque haya N intentos simultáneos.
- **RF-M3-05** El cliente puede **cancelar** y **reprogramar** hasta el inicio de la cita; la reprogramación es atómica (no pierde el cupo si el nuevo está lleno).
- **RF-M3-06** Recordatorios por WhatsApp (o aviso web) a T−24 h y T−2 h con enlaces para confirmar/cancelar.
- **RF-M3-07** El check-in crea el turno en la fila con la categoría `CITA` (M1) si ocurre dentro de la ventana.
- **RF-M3-08** Check-in fuera de ventana: muy temprano ⇒ se informa desde qué hora; tarde dentro de la gracia ⇒ turno **general**; vencida ⇒ no permite.
- **RF-M3-09** El check-in desde el celular exige el **PIN de presencia** (4 dígitos, rota cada 5 min, se muestra en la TV y en el mostrador).
- **RF-M3-10** Job de no-show marca las citas vencidas y aplica el **bloqueo** al alcanzar el límite de inasistencias.
- **RF-M3-11** El admin ve la agenda del día (por cola y franja), puede cancelar, mover, marcar no-show/asistió y bloquear rangos.
- **RF-M3-12** Descarga `.ics` y compartir enlace de la cita.

**Reglas de negocio**
- **RN-M3-01** Un cliente (hash de celular) tiene **como máximo 1 cita activa por cola y día** y **3 citas futuras activas** en total.
- **RN-M3-02** Anticipación: ≥ 60 min y ≤ 14 días (configurables).
- **RN-M3-03** Ventana de check-in por defecto: de `inicio − 10 min` a `inicio + 15 min`.
- **RN-M3-04** Gracia de no-show: `inicio + 10 min` tras la ventana ⇒ la cita pasa a `NO_SHOW` (si no hay check-in).
- **RN-M3-05** Orden en la fila: `emitido_at = max(ahora, slot.inicio)` (llegar temprano no adelanta a nadie) con peso `pesoCita` de la categoría `CITA`; si llega tarde, `emitido_at = ahora` y categoría `GENERAL`.
- **RN-M3-06** Tras `maxNoShow` (3) inasistencias en 90 días, el cliente queda **bloqueado** `bloqueoDias` (30); el admin puede liberarlo.
- **RN-M3-07** Un check-in con turno luego marcado `NO_SE_PRESENTO` cuenta como no-show.
- **RN-M3-08** Cada recordatorio se envía **una sola vez** por cita y tipo.
- **RN-M3-09** Los cambios de configuración no alteran slots ya materializados con reservas (solo futuros sin reservas o con acción explícita de recalcular, que nunca baja de `reservados`).
- **RN-M3-10** Los recordatorios por WhatsApp descuentan de `maxAvisosWhatsapp` del plan; sin cupo se avisa solo por web.

**No funcionales**
- **RNF-M3-01** 50 reservas simultáneas al mismo slot con capacidad 3 ⇒ exactamente 3 exitosas, 0 errores 5xx.
- **RNF-M3-02** `GET slots` p95 < 150 ms para 14 días × 1 cola.
- **RNF-M3-03** Reintentos con la misma `Idempotency-Key` devuelven la misma cita.

## 5. Diseño de datos

```prisma
enum EstadoCita { RESERVADA CONFIRMADA CHECKIN ATENDIDA NO_SHOW CANCELADA }
enum CanalCita  { WEB BOT ADMIN KIOSCO }

model HorarioLocal {              // se crea en N05 (compartido)
  id Int @id @default(autoincrement())
  localId Int @map("local_id")
  diaSemana Int @map("dia_semana")        // 0 = domingo … 6 = sábado
  apertura String                         // "08:00"
  cierre String                           // "17:00"
  activo Boolean @default(true)
  @@unique([localId, diaSemana, apertura])
  @@map("horario_local")
}

model ConfigCitas {
  colaId               Int      @id @map("cola_id")
  activo               Boolean  @default(false)
  duracionSlotMin      Int      @default(15) @map("duracion_slot_min")
  cuotaCitasPct        Int      @default(60) @map("cuota_citas_pct")
  capacidadFija        Int?     @map("capacidad_fija")
  anticipacionMinMin   Int      @default(60) @map("anticipacion_min_min")
  anticipacionMaxDias  Int      @default(14) @map("anticipacion_max_dias")
  checkinAntesMin      Int      @default(10) @map("checkin_antes_min")
  checkinDespuesMin    Int      @default(15) @map("checkin_despues_min")
  graciaNoShowMin      Int      @default(10) @map("gracia_no_show_min")
  maxNoShow            Int      @default(3)  @map("max_no_show")
  bloqueoDias          Int      @default(30) @map("bloqueo_dias")
  pesoCita             Int      @default(40) @map("peso_cita")        // se refleja en la categoría CITA de M1
  recordatoriosMin     Int[]    @default([1440, 120]) @map("recordatorios_min")
  @@map("config_citas")
}

model BloqueoAgenda {
  id Int @id @default(autoincrement())
  localId Int @map("local_id")
  colaId Int? @map("cola_id")             // null = todo el local
  inicio DateTime
  fin DateTime
  motivo String
  @@index([localId, inicio])
  @@map("bloqueo_agenda")
}

model Slot {
  id         Int      @id @default(autoincrement())
  colaId     Int      @map("cola_id")
  inicio     DateTime
  fin        DateTime
  capacidad  Int
  reservados Int      @default(0)
  citas      Cita[]
  @@unique([colaId, inicio])
  @@map("slot")
}
// + en SQL: ALTER TABLE slot ADD CONSTRAINT ck_slot_cupo CHECK (reservados >= 0 AND reservados <= capacidad);

model Cita {
  id                 Int        @id @default(autoincrement())
  localId            Int        @map("local_id")
  colaId             Int        @map("cola_id")
  slotId             Int        @map("slot_id")
  clienteId          Int        @map("cliente_id")
  fecha              DateTime   @db.Date            // fecha local del slot
  estado             EstadoCita @default(RESERVADA)
  canal              CanalCita  @default(WEB)
  token              String     @unique @db.VarChar(16)   // URL /c/:token y QR
  codigoCheckin      String     @unique @db.VarChar(6)    // código corto para tipear
  turnoId            Int?       @unique @map("turno_id")
  tarde              Boolean    @default(false)
  creadaAt           DateTime   @default(now()) @map("creada_at")
  confirmadaAt       DateTime?  @map("confirmada_at")
  checkinAt          DateTime?  @map("checkin_at")
  canceladaAt        DateTime?  @map("cancelada_at")
  motivoCancelacion  String?    @map("motivo_cancelacion")
  eventos            CitaEvento[]
  recordatorios      CitaRecordatorio[]
  @@index([localId, fecha, estado])
  @@index([slotId])
  @@map("cita")
}
// SQL: CREATE UNIQUE INDEX ux_cita_activa ON cita (cliente_id, cola_id, fecha) WHERE estado IN ('RESERVADA','CONFIRMADA');

model CitaEvento       { id BigInt @id @default(autoincrement()) citaId Int @map("cita_id") tipo String datos Json? actor String? createdAt DateTime @default(now()) @map("created_at") @@map("cita_evento") }
model CitaRecordatorio { citaId Int @map("cita_id") tipo String enviadoAt DateTime @default(now()) @map("enviado_at") @@id([citaId, tipo]) @@map("cita_recordatorio") }
model BloqueoCliente   { id Int @id @default(autoincrement()) localId Int @map("local_id") clienteId Int @map("cliente_id") hasta DateTime motivo String liberadoPor Int? @map("liberado_por") createdAt DateTime @default(now()) @map("created_at") @@index([clienteId, hasta]) @@map("bloqueo_cliente") }
model Idempotencia     { clave String @id ruta String respuesta Json expiraAt DateTime @map("expira_at") @@map("idempotencia") }
```

Se añade a `turno`: `cita_id int NULL` (F5) y la categoría `CITA` (M1, peso `pesoCita`, `visibleCliente = false`).

## 6. Lógica y algoritmos

### 6.1 Generación de *slots* (perezosa e idempotente)
```
generarSlots(colaId, fechaLocal):
   horarios = horario_local del día de semana (y de la cola si define el suyo)
   para cada tramo [apertura, cierre): iterar de duracion en duracion
        inicioUTC = aUTC(fechaLocal, hh:mm, zona del local)        // Intl; Lima no tiene DST pero se programa genérico
        omitir si cae en bloqueo_agenda o si inicio < ahora
        INSERT INTO slot(cola_id, inicio, fin, capacidad) VALUES (...) ON CONFLICT (cola_id, inicio) DO NOTHING
```
Se invoca al consultar disponibilidad y por el job nocturno `citas-generar-slots` (próximos `anticipacionMaxDias`).
Capacidad = `capacidadFija ?? max(1, floor(ventanillas_activas_de_la_cola × cuota / 100))`.

### 6.2 Reserva sin sobrecupo (una sola sentencia)
```sql
WITH cupo AS (
  UPDATE slot s
     SET reservados = s.reservados + 1
   WHERE s.id = $1
     AND s.reservados < s.capacidad
     AND s.inicio >= now() + make_interval(mins => $2)         -- anticipación mínima
     AND s.inicio <= now() + make_interval(days => $3)         -- anticipación máxima
  RETURNING s.id, s.cola_id, s.inicio
)
INSERT INTO cita (local_id, cola_id, slot_id, cliente_id, fecha, token, codigo_checkin, canal)
SELECT $4, c.cola_id, c.id, $5, $6, $7, $8, $9::"CanalCita" FROM cupo c
RETURNING *;
```
- El `UPDATE` toma un **bloqueo de fila**; en `READ COMMITTED` un competidor espera, **reevalúa** el `WHERE` y falla si ya no hay cupo ⇒ **no se necesita `SERIALIZABLE`**.
- Si no devuelve fila: segunda consulta `SELECT` para decidir el error (`M3_SLOT_LLENO`, `M3_SLOT_PASADO`, `M3_FUERA_DE_ANTICIPACION`).
- Si el `INSERT` viola `ux_cita_activa` ⇒ **toda la transacción hace *rollback*** (el contador vuelve atrás) y se responde `M3_CITA_DUPLICADA`.
- Validaciones previas fuera de la sentencia: bloqueo del cliente, límite de 3 citas futuras, módulo activo, cola con citas activas.

### 6.3 Cancelar y reprogramar
```
cancelar(cita): tx { UPDATE cita SET estado='CANCELADA', cancelada_at=now() WHERE id=$ AND estado IN ('RESERVADA','CONFIRMADA') RETURNING slot_id;
                     UPDATE slot SET reservados = reservados - 1 WHERE id=$slot AND reservados > 0; evento }
reprogramar(cita, nuevoSlot): tx { SELECT id FROM slot WHERE id IN (viejo, nuevo) ORDER BY id FOR UPDATE;   -- orden fijo ⇒ sin deadlocks
                     UPDATE slot nuevo … reservados+1 WHERE reservados < capacidad  (si 0 filas ⇒ rollback y la cita original queda intacta)
                     UPDATE slot viejo … reservados-1; UPDATE cita SET slot_id=nuevo, fecha=…; evento }
```

### 6.4 Máquina de estados de la cita
```
RESERVADA ──confirmar──► CONFIRMADA ──check-in──► CHECKIN ──turno ATENDIDO──► ATENDIDA
   │                         │                        └──turno NO_SE_PRESENTO──► NO_SHOW
   ├──cancelar──► CANCELADA  ├──cancelar──► CANCELADA
   └──(inicio + ventana + gracia sin check-in)──► NO_SHOW      (también desde CONFIRMADA)
```
Transiciones validadas en una tabla `TRANSICIONES_CITA` (como `TRANSICIONES` de turnos). Cada cambio escribe `cita_evento`.

### 6.5 Check-in
```
checkin(token, pin?):
   cita = obtener(token); exigir estado ∈ {RESERVADA, CONFIRMADA}
   ahora vs slot.inicio:
      ahora < inicio − checkinAntes            → M3_CHECKIN_MUY_TEMPRANO { disponibleDesde }
      inicio − checkinAntes ≤ ahora ≤ inicio + checkinDespues → dentro: categoría CITA, emitido_at = max(ahora, inicio)
      inicio + checkinDespues < ahora ≤ inicio + checkinDespues + gracia → tarde: categoría GENERAL, emitido_at = ahora, tarde = true
      si no                                    → M3_CITA_VENCIDA
   si canal de check-in = celular: validar pinPresencia(localId, ahora)  (acepta ventana actual y anterior)
   turno = emitirTurno({ colaId, clienteId, canal:'CITA', categoria, emitidoAt, citaId })      // reutiliza F5/M1
   cita → CHECKIN (turnoId); publicar cita:estado
```
**PIN de presencia:** `pin = HMAC_SHA256(secreto_local, localId ‖ floor(epoch/300)) → entero de 4 dígitos` (TOTP simplificado). Se muestra en la TV (RF-M3-09), en el panel y en el kiosco. Se acepta el PIN de la ventana actual y la anterior (tolerancia de reloj).
Check-in por **kiosco (M5)**: escanear QR o teclear `codigoCheckin` equivale a presencia y no pide PIN.

### 6.6 Recordatorios idempotentes
```
cada 5 min, para cada tipo T (1440, 120):
   citas activas con slot.inicio − T minutos ∈ [ahora, ahora + 5 min)
   INSERT INTO cita_recordatorio(cita_id, tipo) ON CONFLICT DO NOTHING RETURNING *   ← solo "gana" una instancia/ejecución
   si gana ⇒ enviar mensaje (plantilla `cita_recordatorio` con enlaces /c/:token?accion=confirmar|cancelar)
```

### 6.7 No-show y bloqueo
```
cada 5 min: UPDATE cita SET estado='NO_SHOW' FROM slot WHERE estado IN ('RESERVADA','CONFIRMADA')
            AND slot.inicio + (checkinDespues + gracia) minutos < now()  RETURNING cliente_id
para cada cliente afectado: n = count(cita NO_SHOW últimos 90 días); si n ≥ maxNoShow ⇒ INSERT bloqueo_cliente(hasta = now + bloqueoDias)
```

### 6.8 `.ics`
`VEVENT` con `UID: cita-<id>@turnoya.pe`, `DTSTART;TZID=America/Lima`, `SUMMARY: Cita en <local> (<servicio>)`, `LOCATION`, `URL`, `VALARM` −2 h.

## 7. API

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/public/locales/:slug/slots?colaId&fecha` | público | Slots del día `{ inicio, disponible, restantes }` (genera si falta) |
| GET | `/public/locales/:slug/disponibilidad?colaId&dias=14` | público | Resumen por día (`abierto`, `libres`) |
| POST | `/public/citas` | público (5/min/IP) | `{ colaId, slotId, nombre, telefono, consentimiento }` + `Idempotency-Key` |
| GET | `/public/citas/:token` | público | Estado y datos de la cita |
| POST | `/public/citas/:token/confirmar` | público | RESERVADA → CONFIRMADA |
| DELETE | `/public/citas/:token` | público | Cancelar |
| POST | `/public/citas/:token/reprogramar` | público | `{ slotId }` |
| POST | `/public/citas/:token/checkin` | público | `{ pin? , codigo? }` ⇒ devuelve `{ turnoToken }` |
| GET | `/public/citas/:token/ics` | público | `text/calendar` |
| GET | `/public/locales/:slug/pin-presencia` | **TV/panel** (token de pantalla o sesión) | PIN vigente y segundos restantes |
| GET | `/citas?fecha&colaId&estado&cursor` | OPERADOR+ | Agenda |
| GET | `/citas/proximas` | OPERADOR+ | Próximos 60 min |
| PATCH | `/citas/:id` | ADMIN+ | `{ accion: "CANCELAR" \| "MOVER" \| "NO_SHOW" \| "ASISTIO", slotId? }` |
| GET/PUT | `/citas/config?colaId` | ADMIN+ | Configuración |
| POST/DELETE | `/citas/bloqueos` | ADMIN+ | Bloqueos de agenda |
| POST/DELETE | `/citas/bloqueos-cliente` | ADMIN+ | Liberar/bloquear cliente |

**Ejemplo `POST /public/citas` (201)**
```json
{ "ok": true, "data": { "token": "K7M2QX9A4P", "codigoCheckin": "H7K2QP",
  "estado": "RESERVADA", "inicio": "2026-10-20T15:30:00.000Z", "inicioLocal": "2026-10-20 10:30",
  "cola": "Medicina General", "urlQr": "https://…/c/K7M2QX9A4P" } }
```
**Errores:** `M3_SLOT_LLENO` (409), `M3_SLOT_PASADO` (409), `M3_FUERA_DE_ANTICIPACION` (422), `M3_CLIENTE_BLOQUEADO` (403, `hasta`), `M3_CITA_DUPLICADA` (409), `M3_LIMITE_CITAS` (409), `M3_CITA_NO_ENCONTRADA` (404), `M3_ESTADO_INVALIDO` (409), `M3_CHECKIN_MUY_TEMPRANO` (409, `disponibleDesde`), `M3_CITA_VENCIDA` (409), `M3_PIN_INVALIDO` (403), `M3_COLA_SIN_CITAS` (409), `MODULO_NO_DISPONIBLE` (403).

## 8. Jobs y eventos
| Job | Cron | Qué hace |
|---|---|---|
| `citas-generar-slots` | `0 1 * * *` | Prepara slots de los próximos N días |
| `citas-recordatorios` | cada 5 min | §6.6 |
| `citas-no-show` | cada 5 min | §6.7 |
| `citas-limpiar` | `0 4 * * *` | Elimina `idempotencia` vencida y anonimiza citas > 90 días |
Eventos: `cita:estado` (cliente y agenda en vivo), `cola:actualizada` tras el check-in.

## 9. UI
| Ruta | Contenido | Estados |
|---|---|---|
| `/l/[slug]/citas` | 1) elegir servicio · 2) tira de 14 días (cerrados deshabilitados) · 3) rejilla de horarios (disponible/lleno) · 4) datos y consentimiento · 5) confirmación con **QR**, "Agregar al calendario", compartir | cargando · sin horarios · cliente bloqueado · conflicto (alguien reservó antes) |
| `/c/[token]` | Detalle, **Confirmar**, **Cambiar**, **Cancelar**, **Check-in** (PIN) y enlace al turno | cita vencida · check-in temprano (cuenta regresiva) |
| `/admin/modulos/citas` | **Agenda** (columnas por franja, barras `reservados/capacidad`, panel lateral con la lista y acciones), **Configuración**, **Bloqueos**, **Clientes bloqueados** | día cerrado · sin citas |
| `/panel` | Bloque "Citas próximas (60 min)" | — |
| TV | Muestra el **PIN de presencia** rotativo si M3 activo | — |
Accesibilidad: rejilla navegable con teclado; contraste AA; texto de cuenta regresiva con `aria-live`.

## 10. Integración con el núcleo
| Archivo | Cambio |
|---|---|
| `emitirTurno` | Acepta `canal: "CITA"`, `categoriaCodigo`, `emitidoAt`, `citaId`; no aplica límite RN03 duplicado si ya existe el turno de la cita |
| `cambiarEstadoTurno` / `llamarSiguiente` | Al ATENDIDO ⇒ cita `ATENDIDA`; al NO_SE_PRESENTO con cita ⇒ `NO_SHOW` |
| `snapshotLocal` | Incluye `citasProximas` (solo operador) |
| M4 | Handler de respuesta "1/2" a recordatorios llama a `confirmar`/`cancelar` |
| M5 | `POST /kiosco/citas/checkin` reutiliza `checkin()` sin PIN |
| `whatsapp.ts` | Nueva plantilla `renderCitaRecordatorio` y `renderCitaConfirmada` |

## 11. Seguridad y privacidad
- Tokens de 10 caracteres sin ambiguos (`generarToken`) + código corto de 6; rate limit por IP y por teléfono en `POST /public/citas` y `…/checkin` (5 intentos fallidos de PIN ⇒ bloqueo 5 min).
- No se expone el teléfono ni nombres de otros clientes en ningún endpoint público; la agenda con nombres solo para OPERADOR+ del mismo local.
- Consentimiento explícito; cifrado y *hash* del teléfono como en `emitirTurno`; anonimización a los 90 días.
- El PIN de presencia usa un secreto por local (`local.checkin_secret`, 32 bytes aleatorios, almacenado cifrado).

## 12. Pruebas
**Unitarias (`reglas.ts`)**: ventanas de check-in (borde exacto de cada límite), transiciones válidas/ inválidas, cálculo de capacidad, bloqueo por reincidencia, PIN (misma ventana ⇒ mismo valor; ventana anterior aceptada; ventana −2 rechazada), generación de franjas con y sin bloqueo, `.ics` válido.
**Propiedades:** `reservados` siempre en `[0, capacidad]`; `Σ reservados = nº de citas activas del slot`; cancelar + reservar es neutro.
**Concurrencia (BD real):**
- 50 reservas simultáneas, capacidad 3 ⇒ exactamente 3 OK y 47 `M3_SLOT_LLENO`.
- Mismo cliente reserva 2 veces a la vez ⇒ 1 OK y 1 `M3_CITA_DUPLICADA`, y `reservados` sin fugas (rollback).
- Reprogramaciones cruzadas A→B y B→A en paralelo ⇒ sin *deadlock*.
- Reintento con la misma `Idempotency-Key` ⇒ misma cita.
**Zona horaria:** slot 23:30 hora Lima cae en el día UTC siguiente; `fecha` local correcta; semanas con feriado bloqueado.
**Integración:** check-in crea turno con categoría `CITA` y clave calculada con `slot.inicio`; tarde ⇒ GENERAL; `NO_SE_PRESENTO` ⇒ no-show; job de recordatorios envía una sola vez aunque corra dos veces; 3 no-shows ⇒ bloqueo y `M3_CLIENTE_BLOQUEADO`.
**API/permisos:** otro local no ve citas; OPERADOR no configura; módulo apagado ⇒ 403.
**E2E (Playwright, 390×844):** reservar → ver QR → cambiar → check-in con PIN dentro de ventana ⇒ aparece el turno; reservar slot lleno ⇒ mensaje claro.
**Carga (k6):** 200 usuarios reservando en un minuto, p95 < 400 ms.

## 13. Observabilidad
`m3_reservas_total{resultado}`, `m3_slot_lleno_total`, `m3_checkin_total{tipo}`, `m3_no_show_total`, `m3_bloqueos_total`, `m3_recordatorios_enviados_total`; log de cada transición con `citaId`, `estadoAntes`, `estadoDespues`. M7 muestra ocupación de agenda y tasa de no-show.

## 14. Criterios de aceptación
```gherkin
Escenario: No hay sobrecupo
  Dado un slot con capacidad 3
  Cuando 50 clientes intentan reservarlo al mismo tiempo
  Entonces exactamente 3 reservas se confirman y el resto recibe "horario lleno"

Escenario: Check-in en ventana
  Dado una cita a las 10:30 y la hora actual 10:25
  Cuando el cliente hace check-in con el PIN de la TV
  Entonces entra a la fila con prioridad de cita y se le muestra su turno

Escenario: Check-in temprano
  Dado una cita a las 10:30 y la hora actual 09:50
  Cuando el cliente intenta hacer check-in
  Entonces ve "Disponible desde las 10:20"

Escenario: Bloqueo por inasistencias
  Dado un cliente con 3 inasistencias en 90 días
  Cuando intenta reservar
  Entonces recibe "Reservas bloqueadas hasta <fecha>"

Escenario: Reprogramar sin perder cupo
  Dado una cita y un nuevo horario lleno
  Cuando el cliente intenta reprogramar
  Entonces la cita original se conserva
```

## 15. Riesgos
| Riesgo | Mitigación |
|---|---|
| Sobrecupo por condiciones de carrera | Una sola sentencia con `WHERE reservados < capacidad` + restricción `CHECK` + pruebas de 50 hilos |
| Fraude de check-in remoto | PIN rotativo de presencia; check-in presencial por kiosco/QR |
| Zonas horarias/DST | Todo en `timestamptz`; conversión con `Intl` en el borde; pruebas con fechas límite |
| Citas que dejan ventanillas ociosas | Cuota de cupos (60 %) y job que devuelve cupos no reclamados al mostrador pasada la gracia |
| Costo de WhatsApp | Contabilizar en el plan; degradar a aviso web |

## 16. Plan de tareas
| ID | Tarea | Horas | Estado |
|---|---|---|---|
| M3-T01 | Modelo y migración (tablas, índices parciales, `CHECK`), seed de `config_citas`, categoría `CITA` | 4 | [ ] |
| M3-T02 | Generación de slots (lógica pura + SQL) y utilidades de zona horaria | 5 | [ ] |
| M3-T03 | Reservar/cancelar/reprogramar atómicos + idempotencia + pruebas de concurrencia | 9 | [ ] |
| M3-T04 | Reglas puras (ventanas, estados, no-show, bloqueo, PIN) + pruebas | 5 | [ ] |
| M3-T05 | Check-in (PIN, creación de turno vía F5/M1) | 7 | [ ] |
| M3-T06 | Jobs: generar slots, recordatorios, no-show, limpieza | 6 | [ ] |
| M3-T07 | API pública y de admin (zod, permisos, errores, rate limit) | 7 | [ ] |
| M3-T08 | `.ics`, QR y página `/c/[token]` | 3 | [ ] |
| M3-T09 | UI cliente: flujo de reserva | 5 | [ ] |
| M3-T10 | UI admin: agenda, configuración, bloqueos; bloque en `/panel` y PIN en la TV | 7 | [ ] |
| M3-T11 | Integración con M4/M5, E2E, carga y documentación | 6 | [ ] |
| **Total** | | **64** | |
