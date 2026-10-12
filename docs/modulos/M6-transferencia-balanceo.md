# M6 · Transferencia de turnos y balanceo automático

**Responsable:** Integrante 3 · **Estimación:** 56 h · **Complejidad:** ●●●●○ · **Plan:** transferencia manual en EMPRENDE; reglas automáticas en PRO
**Depende de:** F0, F1 (jobs), F2 (bus), F3, F4 (auditoría con actor), F5 (`emitir_turno` con fecha de emisión; `siguienteTurno`), **M1** (clave de orden y categoría) · **Se integra con:** M7 (métricas/alertas), M2 (espera)
**Pantallas Figma previstas:** M6a Modal "Transferir turno" (operador) · M6b Reglas de balanceo, carga por ventanilla e historial (admin)

---

## 1. Resumen y objetivo

Las colas se desbalancean: Medicina General con 20 min de espera mientras Caja está vacía. Y los clientes llegan a la cola equivocada. M6 ofrece dos capacidades:

1. **Transferencia de turnos** (manual, por el operador): mover un turno a otra cola/ventanilla **sin que el cliente pierda su antigüedad ni su prioridad**.
2. **Balanceo automático** (reglas del admin): un **motor de reglas** evento‑condición‑acción que observa métricas de carga y ejecuta acciones —abrir una ventanilla, mover un operador, derivar turnos, avisar— con **histéresis**, **cooldown**, **modo simulación** y **confirmación opcional**.

La parte técnica difícil es **evitar oscilaciones y acciones contradictorias** y **hacerlo de forma segura con varias instancias**.

## 2. Alcance

**Incluye:** transferencia manual con motivo y notificación al cliente; continuidad del enlace de seguimiento (`sucesor`); conservación de `emitido_at`, categoría y clave de orden; catálogo de métricas; DSL de condiciones; acciones (`ABRIR_VENTANILLA`, `MOVER_OPERADOR`, `DERIVAR_TURNOS`, `NOTIFICAR`, `AJUSTAR_ALFA`); evaluador con histéresis y cooldown; modo simulación (*dry‑run*) por defecto; flujo de confirmación; detección de reglas contradictorias; límite de acciones por hora; historial; mapa de carga en vivo.

**No incluye (v1):** optimización global (programación lineal), predicción de carga futura para anticiparse (usaría M2/M7: stretch), reasignación automática de **personas** entre locales.

## 3. Actores e historias

| Actor | Historia |
|---|---|
| Operador | Si un cliente llegó a la cola equivocada, lo transfiero con un motivo y conserva su lugar |
| Cliente | Si me transfieren, recibo un aviso con mi nuevo código y mi enlace sigue funcionando |
| Admin | Defino reglas ("si la espera en Medicina > 20 min por 5 min, mueve un operador de Caja") |
| Admin | Pruebo la regla en modo simulación antes de activarla y veo qué habría hecho |
| Admin | Veo en tiempo real la carga por cola/ventanilla y el historial de acciones automáticas |
| Sistema | No hago ping‑pong de operadores ni ejecuto la misma regla dos veces |

## 4. Requisitos

**Funcionales**
- **RF-M6-01** El operador transfiere un turno `EMITIDO`, `AVISADO` o `LLAMADO` a otra cola (y opcionalmente ventanilla) con un **motivo** del catálogo.
- **RF-M6-02** La transferencia conserva `emitido_at`, categoría (M1) y `clave_orden`; el turno original pasa a `TRANSFERIDO` y se crea un **turno sucesor** en la cola destino con código nuevo.
- **RF-M6-03** El enlace `/t/:token` del cliente sigue funcionando: muestra el turno sucesor y lo avisa por WhatsApp/web.
- **RF-M6-04** El admin crea reglas con: nombre, condición, acción, cooldown, histéresis, requiere confirmación y modo (`SIMULACION` | `ACTIVA`).
- **RF-M6-05** El evaluador corre cada 30 s por local con métricas calculadas en **una sola consulta**.
- **RF-M6-06** Una regla en `SIMULACION` registra qué haría sin ejecutarlo; en `ACTIVA` ejecuta (o crea una solicitud de confirmación si así se configuró).
- **RF-M6-07** Las acciones temporales (p. ej. mover operador) se **revierten** cuando la condición de salida se cumple (histéresis) o vence su TTL.
- **RF-M6-08** El admin ve el **mapa de carga** (en espera, espera máxima, ventanillas operativas, utilización) por cola y por ventanilla, con actualización en vivo.
- **RF-M6-09** El historial de ejecuciones (regla, métricas, resultado, actor) es filtrable y exportable.
- **RF-M6-10** El sistema rechaza guardar reglas **contradictorias** (mismo recurso, acciones opuestas, sin separación suficiente).

**Reglas de negocio**
- **RN-M6-01** Estados transferibles: `EMITIDO`, `AVISADO`, `LLAMADO` (este último solo si el operador lo libera antes de atenderlo). `ATENDIDO`, `NO_SE_PRESENTO`, `CANCELADO`, `TRANSFERIDO` no se transfieren.
- **RN-M6-02** El sucesor hereda `emitido_at`, `categoria_id`, `cliente_id` y `canal`; su `clave_orden` se **recalcula** con el peso y el α vigentes de la cola destino.
- **RN-M6-03** RN03: si el cliente ya tiene un turno activo en la cola destino, la transferencia se rechaza (`M6_CLIENTE_YA_EN_DESTINO`).
- **RN-M6-04** Una regla se dispara solo si su condición se mantiene **verdadera durante `forSeconds`** continuos.
- **RN-M6-05** **Cooldown**: tras ejecutarse, no se vuelve a ejecutar hasta pasados `cooldownSeg` (mín. 120 s).
- **RN-M6-06** **Histéresis**: la reversión exige que la métrica baje del umbral × (1 − `histeresisPct`) (def. 20 %) durante `forSecondsReversa`.
- **RN-M6-07** Máx. **6 acciones automáticas por hora y por local**; superado el límite se registra `OMITIDA_LIMITE` y se alerta al admin.
- **RN-M6-08** Una ventanilla no puede ser movida por reglas distintas dentro de la misma ventana de cooldown (exclusión mutua por recurso).
- **RN-M6-09** Toda regla nueva nace en `SIMULACION`; activarla requiere rol ADMIN_LOCAL y deja auditoría.

**No funcionales**
- **RNF-M6-01** Evaluar un local (10 reglas, 99 colas) < 150 ms.
- **RNF-M6-02** Con 2 instancias de la app, cada regla se evalúa **una sola vez** por ciclo.
- **RNF-M6-03** Transferencia p95 < 300 ms.

## 5. Diseño de datos

```prisma
enum OrigenTransferencia { MANUAL REGLA }
// EstadoTurno += TRANSFERIDO (F5)

model Transferencia {
  id               Int      @id @default(autoincrement())
  localId          Int      @map("local_id")
  turnoOrigenId    Int      @map("turno_origen_id")
  turnoDestinoId   Int      @map("turno_destino_id")
  deColaId         Int      @map("de_cola_id")
  aColaId          Int      @map("a_cola_id")
  aVentanillaId    Int?     @map("a_ventanilla_id")
  motivo           String                               // catálogo: OTRO_SERVICIO | FALTA_DOCUMENTO | DERIVACION | ERROR_DE_COLA | BALANCEO
  detalle          String?
  origen           OrigenTransferencia
  reglaId          Int?     @map("regla_id")
  usuarioId        Int?     @map("usuario_id")
  conservoAntiguedad Boolean @default(true) @map("conservo_antiguedad")
  createdAt        DateTime @default(now()) @map("created_at")
  @@index([localId, createdAt])
  @@map("transferencia")
}

model ReglaBalanceo {
  id                  Int      @id @default(autoincrement())
  localId             Int      @map("local_id")
  nombre              String
  activa              Boolean  @default(false)
  modo                String   @default("SIMULACION")         // SIMULACION | ACTIVA
  condicion           Json                                     // ver §6.2
  accion              Json                                     // ver §6.3
  forSegundos         Int      @default(300) @map("for_segundos")
  forSegundosReversa  Int      @default(300) @map("for_segundos_reversa")
  cooldownSeg         Int      @default(600) @map("cooldown_seg")
  histeresisPct       Int      @default(20)  @map("histeresis_pct")
  ttlSeg              Int?     @map("ttl_seg")                 // acciones temporales
  requiereConfirmacion Boolean @default(false) @map("requiere_confirmacion")
  prioridad           Int      @default(100)                   // menor = se evalúa antes
  createdBy           Int?     @map("created_by")
  createdAt           DateTime @default(now()) @map("created_at")
  estado              ReglaEstado?
  ejecuciones         EjecucionRegla[]
  @@index([localId, activa])
  @@map("regla_balanceo")
}

model ReglaEstado {                                            // memoria del evaluador (sobrevive a reinicios)
  reglaId          Int       @id @map("regla_id")
  fase             String    @default("INACTIVA")             // INACTIVA | ARMADA | ACTIVA | REVIRTIENDO
  verdaderaDesde   DateTime? @map("verdadera_desde")
  falsaDesde       DateTime? @map("falsa_desde")
  ultimaEjecucionAt DateTime? @map("ultima_ejecucion_at")
  estadoAccion     Json?     @map("estado_accion")            // lo necesario para revertir (p. ej. ventanilla y cola original)
  regla            ReglaBalanceo @relation(fields: [reglaId], references: [id], onDelete: Cascade)
  @@map("regla_estado")
}

model EjecucionRegla {
  id         BigInt   @id @default(autoincrement())
  reglaId    Int      @map("regla_id")
  localId    Int      @map("local_id")
  ts         DateTime @default(now())
  fase       String                                           // DISPARO | REVERSION | SIMULACION | CONFIRMACION
  metricas   Json
  resultado  String                                           // EJECUTADA | SIMULADA | PENDIENTE_CONFIRMACION | RECHAZADA | OMITIDA_COOLDOWN | OMITIDA_LIMITE | FALLIDA
  detalle    Json?
  confirmadaPor Int?  @map("confirmada_por")
  regla      ReglaBalanceo @relation(fields: [reglaId], references: [id], onDelete: Cascade)
  @@index([localId, ts])
  @@map("ejecucion_regla")
}
// Ventanilla: colaOriginalId Int?, asignacionTemporalHasta DateTime?, reglaAsignadoraId Int?
// Turno: transferidoDeTurnoId Int?, sucesorId Int?   (F5)
```

## 6. Diseño de la solución

### 6.1 Transferencia (una transacción)
```
transferir(turnoId, aColaId, motivo, usuario):
  tx {
    t = SELECT * FROM turno WHERE id=$ AND local_id=$sesion FOR UPDATE           // bloquea el turno
    validar RN-M6-01 (estado), cola destino activa y del mismo local, RN03 en destino
    nuevo = emitir_turno(aColaId, t.cliente_id, t.canal, nuevoToken, hoy, t.categoria_id, p_emitido = t.emitido_at, origen = {transferido_de: t.id})
    UPDATE turno SET estado='TRANSFERIDO', finalizado_at=now(), sucesor_id=nuevo.id WHERE id=t.id
    INSERT INTO transferencia (...)
    si t estaba LLAMADO: liberar la ventanilla (ventanilla_id = NULL en el original)
  }
  publicar turno:estado (original), cola:actualizada (origen y destino)
  notificar al cliente: plantilla `turno_transferido` ("Te derivamos a {cola}. Tu nuevo turno es {codigo}. Sigue aquí: {url}")
```
- `emitir_turno` con `p_emitido = t.emitido_at` hace que el sucesor **conserve su lugar** por la clave de orden (M1).
- **Enlace del cliente:** `GET /public/turnos/:token` del turno original (estado `TRANSFERIDO`) responde con `redirigidoA: { token, codigo }`; la UI redirige a `/t/<token sucesor>`.
- Auditoría con actor (F4) en la misma transacción.

### 6.2 Catálogo de métricas y DSL de condiciones
Todas se calculan **en una consulta** por local (CTE con agregaciones sobre `turno` y `ventanilla`):

| Métrica | Definición | Alcance (`scope`) |
|---|---|---|
| `en_espera` | turnos `EMITIDO/AVISADO` hoy | `cola` |
| `espera_max_min` | edad (min) del turno más antiguo en espera | `cola` |
| `espera_prom_min` | promedio de `llamado − emitido` de los llamados en los últimos 15 min | `cola` |
| `ventanillas_operativas` | ventanillas de la cola con actividad en 15 min (igual definición que M2/RN-M2-04) | `cola` |
| `ventanillas_libres` | operativas sin turno `LLAMADO` | `cola` |
| `utilizacion` | `1 − libres/operativas` | `cola` |
| `tasa_llegada_15m` | emisiones / 15 min | `cola` |
| `sla_cumplimiento` | % con espera ≤ objetivo (M7) | `cola` |
| `espera_prom_local` | promedio de todas las colas | `local` |

```json
{ "all": [
    { "metric": "espera_prom_min", "scope": { "cola": 3 }, "op": ">", "value": 20 },
    { "metric": "ventanillas_libres", "scope": { "cola": 5 }, "op": ">=", "value": 1 } ] }
```
Operadores: `>`, `>=`, `<`, `<=`, `==`; combinadores `all` (Y), `any` (O), `not`. Validado con **zod** y con una función `validarCondicion()` que comprueba métricas/alcances existentes y rangos.

### 6.3 Acciones
| Acción | Parámetros | Efecto | Reversible |
|---|---|---|---|
| `ABRIR_VENTANILLA` | `ventanillaId` | `activa = true` (y asigna cola) | sí (cierra) |
| `MOVER_OPERADOR` | `desdeColaId`, `haciaColaId`, `ventanillaId?` (si no, elige una libre) | `ventanilla.cola_id = hacia`, guarda `cola_original_id` | sí (devuelve a la original) |
| `DERIVAR_TURNOS` | `deColaId`, `aColaId`, `cantidad`, `categorias[]?` | Transfiere los *n* últimos de la cola (los de mayor `clave_orden` más baja) vía §6.1 | no |
| `NOTIFICAR` | `canal` (in‑app/WhatsApp/correo), `mensaje` | Crea alerta (M7) | n/a |
| `AJUSTAR_ALFA` | `delta` | Cambia α de M1 en ±δ dentro de límites | sí |

### 6.4 Evaluador (máquina de estados por regla)
```
fases:  INACTIVA ──cond verdadera──► ARMADA ──(verdadera durante forSegundos)──► [ejecutar] ──► ACTIVA
        ARMADA ──cond falsa──► INACTIVA
        ACTIVA ──(métrica < umbral × (1−histeresis) durante forSegundosReversa, o TTL)──► REVIRTIENDO ──► INACTIVA
```
Pseudocódigo por ciclo (cada 30 s, **por local**):
```
adquirir pg_try_advisory_lock(hashtext('balanceo:'||localId))  → si falla, salir (otra instancia lo hace)
metricas = calcularMetricas(localId, ahora)                       // 1 consulta
para regla en reglas activas ordenadas por prioridad:
    est = cargarEstado(regla)
    cond = evaluar(regla.condicion, metricas)
    switch est.fase:
      INACTIVA: si cond ⇒ est = ARMADA(verdaderaDesde = ahora)
      ARMADA  : si !cond ⇒ INACTIVA
                sino si ahora − verdaderaDesde ≥ forSegundos ⇒ intentarEjecutar(regla, est, metricas)
      ACTIVA  : si condSalida (métrica por debajo del umbral con histéresis) sostenida forSegundosReversa o TTL vencido ⇒ revertir(regla, est)
intentarEjecutar:
    si ahora − ultimaEjecucionAt < cooldownSeg ⇒ registrar OMITIDA_COOLDOWN
    si acciones/hora ≥ 6                       ⇒ registrar OMITIDA_LIMITE (+ alerta)
    si recurso (ventanilla) ya movido por otra regla en cooldown ⇒ OMITIDA
    si regla.modo == SIMULACION ⇒ registrar SIMULADA con detalle "habría hecho X"
    si requiereConfirmacion    ⇒ crear solicitud PENDIENTE_CONFIRMACION (aviso en admin y WhatsApp al admin)
    sino ejecutar acción en tx + auditoría; guardar estadoAccion (para revertir); fase = ACTIVA; ultimaEjecucionAt = ahora
liberar el lock
```
El estado (`regla_estado`) vive en BD: un reinicio no "olvida" que una regla ya estaba armada o activa.
Función pura `avanzar(estado, condicion, metricas, ahora, config) → { estado', decision }` ⇒ 100 % testeable con **reloj falso**.

### 6.5 Validación de reglas contradictorias
Al guardar una regla se analiza, contra las demás **activas** del local:
- Dos reglas con `MOVER_OPERADOR` sobre las mismas colas en sentido opuesto **y** cooldown < 2 × `forSegundos` ⇒ `M6_REGLAS_CONTRADICTORIAS`.
- Condición imposible (`x > 20` y `x < 10` en el mismo `all`) ⇒ `M6_CONDICION_IMPOSIBLE`.
- Histéresis < 5 % ⇒ aviso (puede oscilar).

### 6.6 Mapa de carga en vivo
`GET /balanceo/carga` devuelve el snapshot de métricas por cola y por ventanilla; la UI se refresca con `cola:actualizada` y `balanceo:accion` (F2). Semáforo: verde (< 80 % del objetivo), ámbar (80–100 %), rojo (> objetivo de M7).

## 7. API

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/turnos/:id/transferir` | OPERADOR+ | `{ aColaId, aVentanillaId?, motivo, detalle? }` |
| GET | `/transferencias?desde&hasta&cola&cursor` | ADMIN+ | Historial |
| GET | `/balanceo/reglas` · POST | ADMIN+ | Lista/crea (nace en SIMULACION) |
| PATCH/DELETE | `/balanceo/reglas/:id` | ADMIN+ | Edita, activa (`modo: "ACTIVA"`), desactiva, elimina |
| POST | `/balanceo/reglas/validar` | ADMIN+ | Valida condición/acción y contradicciones sin guardar |
| POST | `/balanceo/reglas/:id/probar` | ADMIN+ | Evalúa con métricas actuales y devuelve qué haría |
| GET | `/balanceo/carga` | ADMIN+ | Snapshot de carga |
| GET | `/balanceo/ejecuciones?regla&resultado&cursor` | ADMIN+ | Historial de ejecuciones |
| POST | `/balanceo/ejecuciones/:id/confirmar` · `/rechazar` | ADMIN+ | Resuelve `PENDIENTE_CONFIRMACION` |
| GET | `/public/turnos/:token` | público | Para turnos transferidos incluye `redirigidoA` |

**Errores:** `M6_ESTADO_NO_TRANSFERIBLE` (409), `M6_COLA_DESTINO_INVALIDA` (404), `M6_CLIENTE_YA_EN_DESTINO` (409), `M6_REGLAS_CONTRADICTORIAS` (409), `M6_CONDICION_INVALIDA` (422), `M6_CONDICION_IMPOSIBLE` (422), `M6_LIMITE_REGLAS` (402), `M6_EJECUCION_NO_PENDIENTE` (409), `MODULO_NO_DISPONIBLE` (403).

## 8. Jobs y eventos
| Job | Cron | Qué hace |
|---|---|---|
| `balanceo-evaluar` | cada 30 s | Ciclo §6.4 (con *advisory lock* por local) |
| `balanceo-ttl` | cada 1 min | Revierte acciones temporales vencidas |
| `balanceo-limpiar` | `0 4 * * *` | Elimina ejecuciones > 90 días |
Eventos: `balanceo:accion` (ejecutada/simulada/pendiente), `turno:estado` y `cola:actualizada` en transferencias.

## 9. UI
| Ruta | Contenido |
|---|---|
| `/panel` (modificado) | Botón **Transferir** en el turno actual y en la lista de espera ⇒ **modal**: cola/ventanilla destino (con carga actual de cada una), motivo (lista), detalle, opción "Notificar al cliente" |
| `/admin/modulos/balanceo` — **Reglas** | Tabla de reglas con interruptor y modo (Simulación/Activa), editor con **constructor de condiciones** (selectores de métrica, operador, valor, duración), selector de acción, cooldown/histéresis, botón **Probar ahora** |
| — **Carga** | Barras por ventanilla/cola con semáforo y actualización en vivo |
| — **Historial** | Tabla de ejecuciones (regla, métricas, resultado, quién confirmó), filtro y exportación CSV |
| — **Confirmaciones** | Solicitudes pendientes con "Aprobar / Rechazar" |
Estados: sin reglas (plantillas sugeridas), modo simulación visible con etiqueta, error de validación inline.

## 10. Integración con el núcleo
| Archivo | Cambio |
|---|---|
| `emitir_turno()` / `siguienteTurno()` (F5/M1) | Respetan `p_emitido` y `clave_orden` |
| `src/lib/turnos.ts` | `transicionValida`: `EMITIDO/AVISADO/LLAMADO → TRANSFERIDO`; `obtenerTurnoPorToken` devuelve `redirigidoA` |
| `src/app/api/v1/ventanillas/[id]/route.ts` | Soporta asignación temporal (`colaOriginalId`, `asignacionTemporalHasta`) |
| `src/lib/whatsapp.ts` | Plantilla `turno_transferido` |
| `src/lib/realtime.ts` | Evento `balanceo:accion` |
| M7 | Las ejecuciones fallidas/omitidas generan alertas; métricas de SLA disponibles para condiciones |

## 11. Seguridad y privacidad
- Solo OPERADOR+ del mismo local transfiere; las reglas solo las edita ADMIN_LOCAL; activar exige confirmación explícita y queda auditado con actor.
- Las acciones automáticas actúan **solo** sobre recursos del local de la regla; validación con `localId` de sesión (no del cuerpo).
- Los mensajes de transferencia no incluyen datos sensibles (categoría de M1).
- Límite de acciones por hora y exclusión mutua por recurso (RN-M6-07/08) como protección ante reglas mal configuradas.

## 12. Pruebas
**Unitarias (`reglas.ts`, reloj falso):** evaluador `avanzar()`: no dispara antes de `forSegundos`; un parpadeo de la condición (verdadero 4 min, falso 10 s) **reinicia** el armado; cooldown; histéresis (no revierte hasta bajar el 20 %); TTL; límite de 6/h; exclusión mutua; validador de contradicciones (casos A↔B, imposibles); DSL (`all/any/not`).
**Propiedades:** (1) **sin oscilación**: para métricas senoidales alrededor del umbral, nº de disparos ≤ ⌈T/cooldown⌉; (2) **conservación de antigüedad**: transferir nunca cambia la posición relativa del turno respecto de turnos de su categoría en la cola destino anteriores a `emitido_at`; (3) **no pérdida**: la suma de turnos en espera + transferidos se conserva.
**Integración (BD real):**
- Transferencia: el sucesor tiene el mismo `emitido_at`, `clave_orden` calculada en destino y `sucesor_id` en el original; el enlace redirige.
- Concurrencia: transferir mientras otra ventanilla llama el mismo turno ⇒ exactamente una operación gana (`FOR UPDATE`).
- RN03 en destino ⇒ `M6_CLIENTE_YA_EN_DESTINO`.
- Evaluador con 2 instancias simultáneas ⇒ una sola ejecución por ciclo (*advisory lock*).
- Reinicio del proceso con regla ARMADA ⇒ continúa (estado en BD).
- Reversión devuelve la ventanilla a su cola original.
**API/permisos:** OPERADOR no accede a reglas; otro local no ve ejecuciones; módulo apagado ⇒ 403.
**E2E:** escenarios 9 y 10 del plan (transferencia manual; regla en simulación registra y en activa mueve operador).
**Carga:** 99 colas y 10 reglas evaluadas en < 150 ms.

## 13. Observabilidad
`m6_transferencias_total{motivo}`, `m6_reglas_evaluadas_total`, `m6_disparos_total{regla,resultado}`, `m6_eval_ms`, `m6_reversiones_total`, `m6_limite_total`. Cada ejecución guarda las métricas que la provocaron (para auditar "por qué").

## 14. Criterios de aceptación
```gherkin
Escenario: Transferencia conserva el lugar
  Dado un cliente con turno A-012 emitido a las 10:00 en Medicina General
  Cuando el operador lo transfiere a Laboratorio a las 10:25
  Entonces recibe el turno L-020 con hora de emisión 10:00
  Y su enlace de seguimiento muestra el nuevo turno

Escenario: Regla en simulación
  Dado una regla nueva "Refuerzo Medicina" en modo Simulación
  Cuando la espera promedio en Medicina supera 20 min durante 5 min
  Entonces se registra "habría movido a Operador 5 de Caja a Medicina" y no se mueve a nadie

Escenario: Regla activa con histéresis
  Dado la regla en modo Activa
  Cuando la condición se cumple 5 min
  Entonces se mueve un operador de Caja a Medicina
  Y cuando la espera baja de 16 min durante 5 min se devuelve a Caja

Escenario: Sin ping-pong
  Dado dos reglas que moverían el mismo operador en sentidos opuestos
  Cuando el admin intenta guardar la segunda
  Entonces recibe "Reglas contradictorias"

Escenario: Confirmación
  Dado una regla con confirmación requerida
  Cuando se dispara
  Entonces el admin ve la solicitud y la acción se ejecuta solo al aprobar
```

## 15. Riesgos
| Riesgo | Mitigación |
|---|---|
| Oscilaciones y acciones contradictorias | Histéresis, cooldown, exclusión mutua, validador, límite por hora |
| Reglas peligrosas en producción | Nacen en simulación; confirmación opcional; auditoría; botón "desactivar todo" |
| Doble ejecución con varias instancias | *Advisory lock* por local + estado en BD + idempotencia de acciones |
| El cliente se pierde al cambiar de código | Redirección de enlace + aviso por WhatsApp/web + código provisional visible |
| Métricas ruidosas con poco tráfico | Mínimo de muestras por métrica (p. ej. ≥ 5 llamados en 15 min) antes de evaluar |

## 16. Plan de tareas
| ID | Tarea | Horas | Estado |
|---|---|---|---|
| M6-T01 | Modelo y migración (transferencia, reglas, estado, ejecuciones, columnas de `ventanilla`/`turno`, estado `TRANSFERIDO`) | 4 | [ ] |
| M6-T02 | Transferencia transaccional + conservación de antigüedad + redirección + notificación | 8 | [ ] |
| M6-T03 | Métricas: consulta única y catálogo | 5 | [ ] |
| M6-T04 | DSL de condiciones, validación y detección de contradicciones | 6 | [ ] |
| M6-T05 | Evaluador puro `avanzar()` (fases, histéresis, cooldown, TTL, límites) + pruebas con reloj falso | 8 | [ ] |
| M6-T06 | Ejecutor de acciones y reversión + *advisory lock* + estado persistente + job | 8 | [ ] |
| M6-T07 | API (transferir, reglas, probar, carga, ejecuciones, confirmaciones) | 6 | [ ] |
| M6-T08 | UI operador: modal de transferencia | 3 | [ ] |
| M6-T09 | UI admin: reglas con constructor de condiciones, carga, historial, confirmaciones | 6 | [ ] |
| M6-T10 | Pruebas de propiedades/concurrencia, E2E y documentación | 2 | [ ] |
| **Total** | | **56** | |
