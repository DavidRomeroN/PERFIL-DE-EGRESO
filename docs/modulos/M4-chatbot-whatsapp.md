# M4 · Chatbot de WhatsApp

**Responsable:** Integrante 2 · **Estimación:** 56 h · **Complejidad:** ●●●●○ · **Plan:** EMPRENDE y PRO
**Depende de:** F0, F1 (jobs), F2 (bus), F3 (banderas), F5 (canal `WHATSAPP`), proveedor WhatsApp existente (`openwa` / `meta`) · **Se integra con:** M1 (categoría), M2 (estimación), M3 (citas)
**Pantallas Figma previstas:** M4a Conversación (vista del cliente en WhatsApp) · M4b Flujo del bot, bandeja y métricas (admin)

---

## 1. Resumen y objetivo

Hoy WhatsApp es **unidireccional**: TurnoYa envía avisos (`turno_proximo`, `turno_llamado`) y solo recibe *acks* en `/api/v1/webhooks/whatsapp`.
M4 convierte el canal en **bidireccional**: el cliente escribe al número del local y puede **tomar turno, consultar su posición, cancelar, ver horarios y
agendar una cita**, sin abrir el navegador. Para el local es un canal de entrada más; para el equipo es un ejercicio de **máquinas de estado, idempotencia y concurrencia**.

Diseño clave: la conversación es una **FSM pura** (testeable sin red) rodeada por un **orquestador** que carga datos, ejecuta efectos y habla con el proveedor.

## 2. Alcance

**Incluye:** recepción de mensajes entrantes (OpenWA y Meta) con firma HMAC, anti-*replay* e idempotencia; sesión por teléfono; FSM con menú, tomar turno,
posición, cancelar, horarios, cita (si M3 activo) y atención humana (*handoff*); parser tolerante; límites de tasa de entrada y salida; bandeja de conversaciones;
simulador "Probar chatbot"; métricas y embudo; retención y cifrado de mensajes; diagrama generado desde el código.

**No incluye (v1):** NLP/LLM, mensajes multimedia (imágenes/audios; se responde "solo entiendo texto"), grupos, catálogo/pagos, múltiples idiomas (solo español).

## 3. Actores e historias

| Actor | Historia |
|---|---|
| Cliente | Escribo "hola" al WhatsApp del local, elijo un servicio y recibo mi código de turno y el enlace de seguimiento |
| Cliente | Pregunto "¿cuánto falta?" y me responde con mi posición y el tiempo estimado |
| Cliente | Respondo "cancelar" y el bot me pide confirmación |
| Cliente | Pido hablar con una persona |
| Admin | Veo conversaciones, tomo el control de una, y miro métricas |
| Admin | Pruebo el bot sin usar un teléfono |
| Sistema | Ignoro mensajes duplicados, reintentos y spam |

## 4. Requisitos

**Funcionales**
- **RF-M4-01** Recibir mensajes entrantes por webhook (OpenWA y Meta) y normalizarlos a un formato único.
- **RF-M4-02** Resolver el **local** a partir del canal (sesión de OpenWA o `phone_number_id` de Meta).
- **RF-M4-03** Mantener una conversación por (local, teléfono) con estado y contexto; expira a los 15 min de inactividad.
- **RF-M4-04** Menú: 1 Tomar turno · 2 Mi posición · 3 Cancelar turno · 4 Horarios · 5 Agendar cita (si M3) · 6 Hablar con una persona.
- **RF-M4-05** Tomar turno: elegir cola abierta (con espera estimada de M2) → nombre (opcional) → consentimiento → confirmación → emisión con canal `WHATSAPP`.
- **RF-M4-06** Consultar posición con el turno activo (si hay varios, preguntar cuál).
- **RF-M4-07** Cancelar con confirmación explícita.
- **RF-M4-08** Comandos globales válidos en cualquier estado: `MENU`, `AYUDA`, `POSICION`, `CANCELAR`, `ASESOR`, `SALIR`.
- **RF-M4-09** *Handoff* a una persona: el bot calla, se notifica al admin en tiempo real y el admin responde desde la bandeja; puede devolver el control.
- **RF-M4-10** Tras 3 entradas inválidas seguidas ofrecer menú y atención humana.
- **RF-M4-11** Simulador en el admin (`/bot/probar`) que ejecuta la FSM sin enviar mensajes.

**Reglas de negocio**
- **RN-M4-01** Cada mensaje entrante (`proveedor + messageId`) se procesa **una sola vez**.
- **RN-M4-02** Se rechazan eventos con firma inválida o `timestamp` con más de 5 min de antigüedad.
- **RN-M4-03** Mensajes de grupos (`@g.us`), propios (`fromMe`) o de números sin consentimiento previo en tomar turno se ignoran/controlan según §9.
- **RN-M4-04** Máx. 20 mensajes entrantes por teléfono y minuto (`BOT_MAX_MSG_MIN`); el exceso se descarta y se registra.
- **RN-M4-05** Salida: ≥ 1.2 s entre mensajes de una misma conversación y máx. 20 por minuto por número con OpenWA (anti-bloqueo).
- **RN-M4-06** El consentimiento para avisos se pregunta una vez por conversación antes de guardar el teléfono (Ley 29733).
- **RN-M4-07** Retención de `mensaje_bot`: 30 días, cifrados en reposo; los logs nunca contienen el texto ni el teléfono completo.
- **RN-M4-08** Respuestas dentro de la sesión **no** descuentan de `maxAvisosWhatsapp`; las plantillas proactivas sí.

**No funcionales**
- **RNF-M4-01** Respuesta del bot < 2 s p95 (sin contar el proveedor).
- **RNF-M4-02** 5 mensajes simultáneos del mismo teléfono se procesan en orden sin corromper el estado.
- **RNF-M4-03** El webhook responde 200 en < 500 ms; el envío es asíncrono.

## 5. Diseño de datos

```prisma
enum EstadoBot {
  INICIO MENU
  ELEGIR_COLA PEDIR_NOMBRE PEDIR_CONSENTIMIENTO CONFIRMAR_TURNO
  ELEGIR_TURNO_ACTIVO SEGUIMIENTO CONFIRMAR_CANCELAR
  ELEGIR_FECHA ELEGIR_HORA CONFIRMAR_CITA
  HANDOFF CERRADA
}
enum DireccionMensaje { ENTRANTE SALIENTE }

model CanalWhatsapp {
  id            Int     @id @default(autoincrement())
  localId       Int     @map("local_id")
  proveedor     String                                   // openwa | meta
  identificador String                                   // sesión OpenWA o phone_number_id de Meta
  botActivo     Boolean @default(false) @map("bot_activo")
  bienvenida    String?
  atencionHumana Json?  @map("atencion_humana")           // { dias:[1..5], desde:"08:00", hasta:"17:00" }
  @@unique([proveedor, identificador])
  @@map("canal_whatsapp")
}

model ConversacionBot {
  id               String   @id @default(uuid())
  localId          Int      @map("local_id")
  telefonoHash     String   @map("telefono_hash")
  telefonoCifrado  String   @map("telefono_cifrado")
  estado           EstadoBot @default(INICIO)
  contexto         Json     @default("{}")
  handoff          Boolean  @default(false)
  consentimientoAt DateTime? @map("consentimiento_at")
  intentosInvalidos Int     @default(0) @map("intentos_invalidos")
  ultimoMensajeAt  DateTime @default(now()) @map("ultimo_mensaje_at")
  expiraAt         DateTime @map("expira_at")
  createdAt        DateTime @default(now()) @map("created_at")
  mensajes         MensajeBot[]
  @@unique([localId, telefonoHash])
  @@index([localId, handoff, ultimoMensajeAt])
  @@map("conversacion_bot")
}

model MensajeBot {
  id             BigInt           @id @default(autoincrement())
  conversacionId String           @map("conversacion_id")
  direccion      DireccionMensaje
  proveedorMsgId String?          @map("proveedor_msg_id")
  textoCifrado   String           @map("texto_cifrado")
  estado         String           @default("PENDIENTE")    // PENDIENTE|ENVIADO|ENTREGADO|LEIDO|FALLIDO (salientes)
  autor          String?                                    // "bot" | usuarioId (handoff)
  createdAt      DateTime         @default(now()) @map("created_at")
  conversacion   ConversacionBot  @relation(fields: [conversacionId], references: [id], onDelete: Cascade)
  @@index([conversacionId, createdAt])
  @@map("mensaje_bot")
}

model EventoBotProcesado {                // idempotencia del webhook
  proveedor   String
  mensajeId   String   @map("mensaje_id")
  procesadoAt DateTime @default(now()) @map("procesado_at")
  @@id([proveedor, mensajeId])
  @@map("evento_bot_procesado")
}
// CanalTurno += WHATSAPP (F5)
```

## 6. Diseño de la solución

### 6.1 Pipeline de un mensaje entrante
```
POST /webhooks/whatsapp
 1. Verificar firma (X-OpenWA-Signature / X-Hub-Signature-256) con comparación en tiempo constante     → 401 M4_FIRMA_INVALIDA
 2. Adaptar a  MensajeEntrante { proveedor, mensajeId, canalId, desde(E.164), texto, tipo, boton?, ts, esGrupo, propio }
 3. Descartar: grupo, propio, tipo no soportado (responde "solo entiendo texto"), ts > 5 min               (RN-M4-02/03)
 4. Idempotencia: INSERT INTO evento_bot_procesado … ON CONFLICT DO NOTHING RETURNING → si no inserta ⇒ 200 y fin
 5. Rate limit de entrada por teléfono (RN-M4-04)
 6. Responder 200 de inmediato; encolar `bot-procesar` (pg-boss, singletonKey = telefonoHash) 
 7. Job: tx { pg_advisory_xact_lock(hashtextextended(localId||':'||telefonoHash, 0));
              cargar/crear conversación; aplicar expiración;
              lectura = cargarLectura(estado)                // colas, turno activo, slots… SOLO lectura
              r = transicion(estado, ctx, entrada, lectura, ahora)   // FSM pura
              ejecutar r.efectos (emitir, cancelar, reservar, handoff) → si fallan: r2 = transicion(…, RESULTADO_ERROR)
              guardar estado/contexto; guardar mensajes (cifrados); encolar salientes }
 8. Worker de salida `bot-enviar` respetando RN-M4-05.
```
El ***advisory lock* por teléfono** serializa mensajes concurrentes de la misma persona (RNF-M4-02).

### 6.2 Adaptadores de proveedor
| Proveedor | Evento entrante | Notas |
|---|---|---|
| Meta Cloud API | `entry[].changes[].value.messages[]` (`from`, `id`, `timestamp`, `type`, `text.body`, `interactive.button_reply.id`); canal = `metadata.phone_number_id` | Responder dentro de 24 h de la última escritura del usuario |
| OpenWA | Evento de mensaje recibido (**verificar en la documentación de OpenWA el nombre exacto del evento — p. ej. `message.received` — y su payload antes de implementar**); canal = nombre de sesión | Gateway no oficial: respetar RN-M4-05 |
El resto del sistema solo conoce `MensajeEntrante`; cambiar de proveedor no toca la FSM.

### 6.3 Normalización y detección de intención
```
normalizar(s): minúsculas → quitar tildes (NFD) → reemplazar signos/emoji por espacio → colapsar espacios → recortar a 200 caracteres
intención(norm):
   1) número 0–9 (con contexto de opciones del estado)  → NUMERO(n)
   2) comandos globales por palabra exacta: menu, inicio, hola, buenas, ayuda, salir, atras
   3) conjuntos de sinónimos (coincidencia por palabra; tolerancia Levenshtein ≤ 1 en palabras ≥ 5 letras):
        TOMAR_TURNO: turno, sacar, tomar, ticket, numero | POSICION: posicion, cuanto falta, mi turno, cuando
        CANCELAR: cancelar, anular, ya no | HORARIOS: horario, atienden, abren | CITA: cita, agendar, reservar
        HUMANO: asesor, persona, humano, operador | SI: si, sii, ok, claro, confirmo | NO: no, nop, nel
   4) si no coincide → OTRO
```
Ejemplos: `"Cuánto falta??"` → POSICION · `"quiero sacar un tuno"` → TOMAR_TURNO (Levenshtein) · `"👍"` → SI · `"asdf"` → OTRO.

### 6.3b Tabla de transiciones (fuente única de verdad)
La tabla está en código (`src/lib/bot/fsm.ts`) como datos; de ella se **genera** el diagrama (Mermaid) que muestra la UI y la documentación.

| Estado | Entrada | Efectos / respuesta | Siguiente |
|---|---|---|---|
| INICIO | cualquiera | Bienvenida + menú | MENU |
| MENU | `1`/TOMAR_TURNO | Lista de colas abiertas con espera estimada | ELEGIR_COLA |
| MENU | `2`/POSICION | Si 1 turno activo ⇒ estado del turno; si varios ⇒ pregunta; si 0 ⇒ "no tienes turno" | SEGUIMIENTO / ELEGIR_TURNO_ACTIVO / MENU |
| MENU | `3`/CANCELAR | Idem selección de turno | CONFIRMAR_CANCELAR |
| MENU | `4`/HORARIOS | Horario del local | MENU |
| MENU | `5`/CITA (M3) | Lista de fechas | ELEGIR_FECHA |
| MENU | `6`/HUMANO | Efecto HANDOFF | HANDOFF |
| ELEGIR_COLA | `n` válido | Guarda cola; si no hay nombre ⇒ pide nombre | PEDIR_NOMBRE |
| ELEGIR_COLA | inválido | Repite lista, `intentos++` | ELEGIR_COLA (o MENU/HANDOFF si intentos ≥ 3) |
| PEDIR_NOMBRE | texto / OMITIR | Guarda nombre | PEDIR_CONSENTIMIENTO (si falta) o CONFIRMAR_TURNO |
| PEDIR_CONSENTIMIENTO | SI | Registra consentimiento | CONFIRMAR_TURNO |
| PEDIR_CONSENTIMIENTO | NO | "Sin tu permiso no podemos avisarte; puedes tomar turno en el mostrador" | MENU |
| CONFIRMAR_TURNO | SI | Efecto EMITIR_TURNO → mensaje con código, posición, espera y enlace `/t/:token` | SEGUIMIENTO |
| CONFIRMAR_TURNO | NO | Cancela el trámite | MENU |
| CONFIRMAR_CANCELAR | SI | Efecto CANCELAR_TURNO | MENU |
| ELEGIR_FECHA → ELEGIR_HORA → CONFIRMAR_CITA | números/SI | Efectos de M3 | MENU / SEGUIMIENTO |
| cualquiera | `MENU`/`AYUDA` | Menú / ayuda contextual | MENU / mismo |
| cualquiera | `SALIR` | Despedida | CERRADA |
| cualquiera | `ASESOR` | HANDOFF | HANDOFF |
| HANDOFF | mensaje | Se guarda, notifica al admin; el bot no responde | HANDOFF |
| cualquiera | `TIMEOUT` (15 min) | — | CERRADA (al siguiente mensaje: INICIO) |
| cualquiera | `RESULTADO_ERROR(código)` | Mensaje según código (`TURNO_DUPLICADO`, `LIMITE_PLAN`, `COLA_INACTIVA`, `CLIENTE_BLOQUEADO`) | MENU |

### 6.4 Contratos de la FSM (pura)
```ts
type Entrada =
  | { tipo: "TEXTO"; texto: string }
  | { tipo: "BOTON"; id: string }
  | { tipo: "TIMEOUT" }
  | { tipo: "RESULTADO"; ok: boolean; codigo?: string; datos?: unknown };

interface Contexto { colaId?: number; nombre?: string; consentimiento?: boolean; turnoToken?: string;
                     fecha?: string; slotId?: number; intentos: number; opciones?: { id: number; etiqueta: string }[] }

interface Lectura { colasAbiertas: ColaInfo[]; turnosActivos: TurnoInfo[]; horarioTexto: string; fechasDisponibles?: string[]; slots?: SlotInfo[];
                    modulos: { M1: boolean; M3: boolean } }

type Efecto = { tipo: "EMITIR_TURNO"; colaId: number; nombre?: string; categoria?: string }
            | { tipo: "CANCELAR_TURNO"; token: string }
            | { tipo: "RESERVAR_CITA"; slotId: number; nombre?: string }
            | { tipo: "HANDOFF" } | { tipo: "REGISTRAR_CONSENTIMIENTO" };

function transicion(estado: EstadoBot, ctx: Contexto, entrada: Entrada, lectura: Lectura, ahora: Date):
    { estado: EstadoBot; ctx: Contexto; respuestas: string[]; efectos: Efecto[] }
```
Sin acceso a BD ni a la red ⇒ tablas de prueba triviales.

### 6.5 Handoff
- Se activa por `ASESOR`, 3 entradas inválidas o fallo repetido del efecto. Marca `handoff = true`, notifica `bot:handoff` y muestra el chat con borde de alerta en la bandeja.
- Fuera de `atencionHumana`: autorespuesta "Un asesor te escribirá en horario de atención (L–V 8:00–17:00)".
- El admin responde con `POST /bot/conversaciones/:id/responder` (autor = su `usuarioId`); **Devolver al bot** ⇒ estado MENU.
- Si el admin no interviene en 30 min, el job `bot-expirar-sesiones` devuelve la conversación al bot.

### 6.6 Mensajes (catálogo en español, *negritas* de WhatsApp)
```
BIENVENIDA : "¡Hola! 👋 Soy el asistente de *{local}*. ¿Qué deseas hacer?\n1️⃣ Tomar turno\n2️⃣ Mi posición\n3️⃣ Cancelar mi turno\n4️⃣ Horarios\n5️⃣ Agendar cita\n6️⃣ Hablar con una persona"
LISTA_COLAS: "Elige el servicio:\n1️⃣ *Medicina General* · 12 en espera · ~25 min\n2️⃣ *Pediatría* · 5 en espera · ~12 min\n(Responde con el número, o *menu*)"
CONSENT    : "Para avisarte por este chat cuando se acerque tu turno usaremos tu número solo para eso. ¿Aceptas? (*sí* / *no*)"
CONFIRMAR  : "Vas a tomar turno en *Medicina General*. ¿Confirmas? (*sí* / *no*)"
TURNO_OK   : "✅ Listo. Tu turno es *A-023*.\nPosición: 4 · Espera: ~18 min (14–22)\nSigue tu turno: {url}"
NO_ENTIENDO: "No te entendí 🙈. Responde con un número del menú, o escribe *menu* o *asesor*."
```
Ejemplo de conversación completa: `Hola` → bienvenida → `1` → lista → `1` → ¿nombre? → `omitir` → consentimiento → `sí` → confirmar → `sí` → turno A-023.

## 7. API

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET/POST | `/webhooks/whatsapp` | proveedor | **Se extiende**: además de *acks*, procesa mensajes entrantes (§6.1) |
| GET/PUT | `/bot/config` | ADMIN+ | Canal, bienvenida, horario de atención humana, activar/desactivar |
| GET | `/bot/conversaciones?estado&handoff&cursor` | ADMIN+ | Bandeja (teléfono enmascarado) |
| GET | `/bot/conversaciones/:id/mensajes?cursor` | ADMIN+ | Mensajes descifrados (solo para quien tiene permiso) |
| POST | `/bot/conversaciones/:id/responder` | ADMIN+ | Responde como persona (solo en HANDOFF) |
| POST | `/bot/conversaciones/:id/handoff` | ADMIN+ | `{ activo: boolean }` |
| GET | `/bot/metricas?dias=7` | ADMIN+ | Conversaciones, embudo, intents, handoffs, p95 |
| GET | `/bot/flujo` | ADMIN+ | Diagrama Mermaid + tabla de transiciones |
| POST | `/bot/probar` | ADMIN+ | `{ estado?, contexto?, texto }` ⇒ `{ estado, respuestas, efectos }` sin enviar nada |
**Errores:** `M4_BOT_INACTIVO` (409), `M4_FIRMA_INVALIDA` (401), `M4_CONVERSACION_NO_ENCONTRADA` (404), `M4_NO_EN_HANDOFF` (409), `M4_TEXTO_VACIO` (422), `M4_LIMITE_MENSAJES` (429), `MODULO_NO_DISPONIBLE` (403).
El webhook **siempre** responde 200 a eventos válidos (aunque se ignoren) para evitar reintentos del proveedor.

## 8. Jobs y eventos
| Job | Cron | Qué hace |
|---|---|---|
| `bot-procesar` | cola (por mensaje) | Pipeline §6.1 paso 7 |
| `bot-enviar` | cola | Envío con *throttling* y reintentos (3, *backoff* 2 s/10 s/60 s) |
| `bot-expirar-sesiones` | cada 5 min | Pasa a CERRADA las inactivas; devuelve handoff sin respuesta |
| `bot-purgar` | `0 3 * * *` | Elimina mensajes > 30 días y eventos procesados > 7 días |
Eventos: `bot:mensaje` (bandeja en vivo), `bot:handoff`.

## 9. UI (admin)
| Pestaña | Contenido |
|---|---|
| **Flujo** | Diagrama generado (Mermaid) de estados y transiciones; lista de sinónimos por intención (solo lectura en v1); botón "Probar chatbot" |
| **Bandeja** | Lista de conversaciones con estado, último mensaje, etiqueta HANDOFF; panel de chat con campo de respuesta (solo en HANDOFF) y botón "Devolver al bot" |
| **Métricas** | Conversaciones/día, % que concluye con turno, "no entendido", handoffs, tiempo de respuesta p95, embudo por estado, top 5 intenciones |
| **Configuración** | Canal, bienvenida, horario de atención humana, interruptor del bot |
Estados de UI: bot desactivado (CTA para activarlo), sin conversaciones, error de proveedor (enlazar a `/admin/notificaciones` → conexión OpenWA).

## 10. Integración con el núcleo
| Archivo | Cambio |
|---|---|
| `src/app/api/v1/webhooks/whatsapp/route.ts` | Ruta de mensajes entrantes (conserva la rama de *acks*) |
| `src/lib/whatsapp.ts` / `openwa.ts` | `enviarTexto` con *throttle*; adaptadores `adaptarEntranteMeta/OpenWA` |
| `src/lib/turnos.ts` · `emitirTurno` | `canal: "WHATSAPP"`; consentimiento tomado de la conversación |
| M1 | Si activo, el bot pregunta categoría (solo `visibleCliente`) |
| M2 | Espera estimada en la lista de colas y en `SEGUIMIENTO` |
| M3 | Estados de cita y respuesta "1 confirmar / 2 cancelar" a los recordatorios |

## 11. Seguridad y privacidad
- **Firma** verificada **antes** de parsear el cuerpo completo; ventana *anti-replay* de 5 min; comparación `timingSafeEqual` (ya existe `firmaValida`).
- Teléfono con hash para búsqueda y cifrado AES-GCM; texto de mensajes cifrado; **logs sin texto ni teléfono**.
- **Inyección:** el texto del usuario nunca se interpola en SQL ni en plantillas sin escapar; longitud máxima 1 000 caracteres; se descartan caracteres de control.
- **Abuso:** límite de entrada por teléfono, silencio tras 5 infracciones/hora, lista de bloqueo por admin.
- **Alcance:** el bot solo expone datos del **turno del propio teléfono**; nunca de otros clientes.
- Número dedicado y proveedor oficial (`meta`) recomendado en producción (OpenWA es no oficial).

## 12. Pruebas
**Unitarias (FSM y parser):**
- Tabla exhaustiva estado × clase de entrada (≥ 80 casos) con `(estado, respuestas, efectos)` esperados.
- Propiedad: desde **cualquier** estado existe una secuencia de entradas que llega a MENU o CERRADA (sin estados muertos).
- Fuzz: 10 000 cadenas aleatorias (emoji, RTL, 50 000 caracteres, `\u0000`) ⇒ nunca lanza excepción y siempre devuelve ≥ 1 respuesta o un silencio explícito.
- Normalización: `"  ¡HOLA!!  "` → `hola`; `"cuánto falta??"` → `cuanto falta`; Levenshtein: `tuno` ≈ `turno`.
- Contador de intentos: 3 inválidos ⇒ ofrece asesor.
**Integración (BD real):**
- Mensaje duplicado ⇒ 1 sola respuesta y 1 turno emitido.
- 5 mensajes simultáneos del mismo teléfono ⇒ procesados en orden; estado final coherente.
- Firma inválida ⇒ 401; `timestamp` viejo ⇒ ignorado; grupo/`fromMe` ⇒ ignorado.
- Emisión de turno desde el bot respeta RN03 (`TURNO_DUPLICADO` ⇒ mensaje amable) y límite de plan.
- Expiración de sesión y reanudación en INICIO.
- Retención: `bot-purgar` borra solo lo vencido.
**API/permisos:** otro local no ve conversaciones; OPERADOR sin acceso a `/bot/*`; `probar` no envía mensajes.
**E2E:** webhook simulado de Meta y de OpenWA (2 *fixtures*) ⇒ conversación completa de tomar turno y cancelación; handoff con respuesta del admin.
**Carga:** 100 conversaciones simultáneas, p95 < 2 s.

## 13. Observabilidad
`m4_mensajes_entrantes_total{proveedor}`, `m4_no_entendido_total`, `m4_handoff_total`, `m4_turnos_emitidos_total`, `m4_proceso_ms`, `m4_envio_fallido_total`, `m4_duplicados_total`. Embudo: INICIO → ELEGIR_COLA → CONFIRMAR → TURNO (conversión).
Alerta en M7: `WHATSAPP_CAIDO` (≥ 3 envíos fallidos consecutivos).

## 14. Criterios de aceptación
```gherkin
Escenario: Tomar turno por WhatsApp
  Dado el bot activo y un cliente sin turno
  Cuando escribe "hola", elige 1, elige 1, responde "omitir", "sí" y "sí"
  Entonces recibe su código de turno, su posición y el enlace de seguimiento
  Y existe un turno con canal WHATSAPP

Escenario: Mensaje duplicado
  Cuando el proveedor entrega dos veces el mismo mensaje
  Entonces se emite un solo turno y se envía una sola respuesta

Escenario: Firma inválida
  Cuando llega un webhook con firma incorrecta
  Entonces se responde 401 y no se procesa nada

Escenario: Atención humana
  Dado un cliente que escribe "asesor"
  Entonces el bot deja de responder y el admin ve la alerta en la bandeja
  Y al devolver al bot, el siguiente mensaje abre el menú

Escenario: Sin entender
  Cuando el cliente envía tres mensajes sin sentido
  Entonces el bot ofrece el menú y la atención humana
```

## 15. Riesgos
| Riesgo | Mitigación |
|---|---|
| Bloqueo del número (OpenWA no oficial) | Número dedicado, límites de salida, `meta` como camino oficial, proveedor `mock` para la demo |
| Cambio en el formato de eventos de OpenWA | Adaptador aislado + *fixtures* versionadas; verificar la doc antes de implementar |
| Spam o bucles bot↔bot | Ignorar `fromMe`, límite por teléfono, silencio tras infracciones |
| Estados corruptos por mensajes simultáneos | `pg_advisory_xact_lock` por teléfono + pruebas de concurrencia |
| Datos personales en logs | Prueba que revisa que los logs no contengan teléfono ni texto |

## 16. Plan de tareas
| ID | Tarea | Horas | Estado |
|---|---|---|---|
| M4-T01 | Modelo y migración (canal, conversación, mensajes, idempotencia), canal `WHATSAPP` | 4 | [ ] |
| M4-T02 | Normalización y detector de intención + pruebas (incl. fuzz) | 6 | [ ] |
| M4-T03 | FSM pura: tabla de transiciones, contexto, efectos, generación del diagrama + pruebas exhaustivas | 10 | [ ] |
| M4-T04 | Adaptadores de proveedor (Meta/OpenWA) y envío con *throttling* y reintentos | 6 | [ ] |
| M4-T05 | Webhook entrante: firma, *anti-replay*, idempotencia, candado por teléfono, cola `bot-procesar` | 8 | [ ] |
| M4-T06 | Servicios de efectos (emitir, posición, cancelar, horarios; citas si M3) | 6 | [ ] |
| M4-T07 | *Handoff*, bandeja y respuesta del admin | 5 | [ ] |
| M4-T08 | API admin (config, métricas, flujo, probar) | 4 | [ ] |
| M4-T09 | UI admin (flujo, bandeja, métricas, configuración) | 5 | [ ] |
| M4-T10 | Integración con M1/M2/M3, E2E con *fixtures*, documentación | 2 | [ ] |
| **Total** | | **56** | |
