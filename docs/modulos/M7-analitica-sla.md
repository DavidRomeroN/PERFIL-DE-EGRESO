# M7 · Analítica avanzada y SLA con alertas

**Responsable:** Integrante 4 · **Estimación:** 60 h · **Complejidad:** ●●●●○ · **Plan:** PRO (el dashboard básico actual sigue en todos los planes)
**Depende de:** F0, F1 (jobs), F2 (bus), F3, F4 (auditoría con actor), F8 (histórico de 60 días), N07 (valoración) · **Se integra con:** M2 (precisión del modelo), M5 (alerta `KIOSCO_OFFLINE`), M6 (métricas/acciones), M8 (calibración)
**Pantallas Figma previstas:** M7a Analítica (mapa de calor, percentiles, SLA) · M7b Alertas e incidentes · M7c Reportes programados

---

## 1. Resumen y objetivo

El dashboard actual (`/admin`, `reporteEspera`) muestra **promedios y conteos**. Un promedio oculta lo que más molesta al cliente: **la cola de la distribución** (el 10 % que espera el doble) y los
**momentos** en que el servicio se degrada. M7 aporta:

1. **Percentiles (P50/P90/P95)** de espera y atención, y **mapa de calor** de afluencia por día de la semana × hora.
2. **SLA por cola** ("el 90 % de los turnos espera ≤ 15 min") con **cumplimiento móvil** que trata correctamente los turnos aún en espera (*censura a la derecha*).
3. **Motor de alertas** con reglas, **deduplicación**, **escalamiento** por niveles y silenciado; **detección de anomalías** en la afluencia con estadística robusta (MAD).
4. **Reportes programados** (PDF/CSV por correo) y **valoración del servicio** (CSAT) correlacionada con la espera.

## 2. Alcance

**Incluye:** vista materializada de agregados por franja de 30 min; consultas de percentiles; heatmap con tres métricas; SLA por cola con presupuesto de error; alertas (10 tipos); ciclo de vida (abierta → reconocida → resuelta/silenciada) y escalamiento; canales in‑app, WhatsApp y correo; reportes programados con PDF; panel de CSAT; auditoría de configuraciones.

**No incluye (v1):** modelos predictivos de demanda (lo hace M2/M8), integración con herramientas externas (Grafana/Slack), alertas por SMS, BI exportable en tiempo real, reportes multi‑local consolidados.

## 3. Actores e historias

| Actor | Historia |
|---|---|
| Admin | Veo el P90 de espera por cola y cuándo se incumple el SLA, no solo promedios |
| Admin | Veo en qué horas y días llega más gente para planificar personal |
| Admin | Recibo una alerta si la espera supera el objetivo, y se escala si nadie la atiende |
| Admin | Recibo cada lunes un PDF con el resumen semanal |
| Admin | Sé si los clientes están satisfechos y cómo se relaciona con la espera |
| Super admin | Recibo alertas de WhatsApp caído, kioscos sin conexión o jobs fallidos |

## 4. Requisitos

**Funcionales**
- **RF-M7-01** Percentiles P50/P90/P95 de **espera** (llamado − emitido) y **atención** (finalizado − llamado) por cola, hora, día y rango.
- **RF-M7-02** Mapa de calor día de semana × hora con métricas: llegadas medias, espera P90, abandono %.
- **RF-M7-03** El admin define el **SLA por cola**: espera máxima (min), objetivo (%), ventana móvil (min).
- **RF-M7-04** El sistema calcula el **cumplimiento actual** y del día y el **presupuesto de error** consumido.
- **RF-M7-05** Reglas de alerta configurables con umbral, canales y niveles de escalamiento.
- **RF-M7-06** Detección de **anomalías de llegada** frente a la línea base del mismo día/franja.
- **RF-M7-07** Ciclo de vida de alertas: reconocer, resolver, silenciar hasta una fecha, reabrir; resolución automática al normalizarse.
- **RF-M7-08** Notificar por in‑app (campana + toast), WhatsApp y correo según el nivel.
- **RF-M7-09** Reportes programados diario/semanal/mensual, PDF y/o CSV, a una lista de destinatarios; ejecución manual.
- **RF-M7-10** Historial de reportes generados con descarga.
- **RF-M7-11** Panel de **CSAT**: promedio, % de 4–5 estrellas, distribución y CSAT por tramo de espera.
- **RF-M7-12** Alertas del sistema (WhatsApp caído, kiosco sin conexión, deriva de predicción, job fallido, límite de balanceo).
- **RF-M7-13** Exportar cualquier tabla del módulo a CSV.

**Reglas de negocio**
- **RN-M7-01** Cumplimiento del SLA = `cumplen / (cumplen + incumplen)` con **censura a la derecha**: un turno **en espera** con edad > `esperaMax` ya cuenta como incumplimiento; uno con edad ≤ `esperaMax` queda **pendiente** y no entra al denominador (se muestra como "en riesgo" si edad ≥ 80 % de `esperaMax`). Un turno **cancelado** o **no presentado** cuenta solo si su espera superó `esperaMax`.
- **RN-M7-02** Una alerta se **deduplica** por `huella = sha1(tipo | localId | entidad)`; solo puede haber una abierta/reconocida/silenciada por huella.
- **RN-M7-03** Una condición debe cumplirse en **2 evaluaciones consecutivas** (≈ 2 min) para abrir la alerta y estar normal **10 min** para resolverla automáticamente (histéresis).
- **RN-M7-04** Escalamiento: nivel 1 al abrir; nivel 2 si no se reconoce en `t2` min; nivel 3 a los `t3` min; reconocer detiene el escalamiento.
- **RN-M7-05** Tormenta de alertas: máx. **1 notificación por nivel y por huella por hora**; las recurrencias solo incrementan `ocurrencias`.
- **RN-M7-06** Anomalía: |z robusto| > 3.5 con al menos 4 semanas de baseline y ≥ 50 % de la franja transcurrida.
- **RN-M7-07** Un reporte programado se genera **una sola vez por periodo** (clave `(programado, periodo)`).
- **RN-M7-08** Los archivos de reportes se conservan 90 días; la valoración no guarda datos personales.
- **RN-M7-09** Todas las reglas de alerta y los SLA son auditables (quién y cuándo los cambió).

**No funcionales**
- **RNF-M7-01** Consultas de heatmap/percentiles sobre 8 semanas < 300 ms (usa la MV).
- **RNF-M7-02** Evaluación de alertas de un local < 200 ms; con 2 instancias no hay alertas duplicadas.
- **RNF-M7-03** Un PDF semanal de 10 páginas se genera en < 8 s.
- **RNF-M7-04** La campana de alertas se actualiza en < 2 s tras abrirse una alerta.

## 5. Diseño de datos

```prisma
enum EstadoAlerta { ABIERTA RECONOCIDA RESUELTA SILENCIADA }
enum TipoAlerta {
  SLA_INCUMPLIDO ESPERA_ALTA COLA_LARGA ANOMALIA_LLEGADAS VENTANILLA_INACTIVA
  WHATSAPP_CAIDO KIOSCO_OFFLINE PREDICCION_DERIVA BALANCEO_LIMITE JOB_FALLIDO
}

model SlaCola {
  colaId        Int     @id @map("cola_id")
  esperaMaxMin  Int     @map("espera_max_min")            // p. ej. 15
  objetivoPct   Decimal @db.Decimal(5, 2) @map("objetivo_pct")   // p. ej. 90.00
  ventanaMin    Int     @default(60) @map("ventana_min")
  activo        Boolean @default(true)
  @@map("sla_cola")
}

model ReglaAlerta {
  id            Int        @id @default(autoincrement())
  localId       Int        @map("local_id")
  tipo          TipoAlerta
  nombre        String
  umbral        Json                                         // p. ej. { "esperaMaxMin": 20, "cola": 3 } o { "enEspera": 25 }
  niveles       Json                                         // [{ "traMin": 0, "canales": ["IN_APP"] }, { "traMin": 10, "canales": ["WHATSAPP"], "usuarios": [4] }, { "traMin": 30, "canales": ["CORREO"] }]
  resolverTrasMin Int      @default(10) @map("resolver_tras_min")
  silenciadaHasta DateTime? @map("silenciada_hasta")
  activa        Boolean    @default(true)
  createdAt     DateTime   @default(now()) @map("created_at")
  @@index([localId, activa])
  @@map("regla_alerta")
}

model Alerta {
  id             BigInt       @id @default(autoincrement())
  localId        Int          @map("local_id")
  reglaId        Int?         @map("regla_id")
  tipo           TipoAlerta
  huella         String
  entidad        String?                                       // "cola:3", "kiosco:K1"…
  nivel          Int          @default(1)
  estado         EstadoAlerta @default(ABIERTA)
  titulo         String
  detalle        Json
  ocurrencias    Int          @default(1)
  primeraVezAt   DateTime     @default(now()) @map("primera_vez_at")
  ultimaVezAt    DateTime     @default(now()) @map("ultima_vez_at")
  proximoEscalaAt DateTime?   @map("proximo_escala_at")
  reconocidaPor  Int?         @map("reconocida_por")
  reconocidaAt   DateTime?    @map("reconocida_at")
  resueltaAt     DateTime?    @map("resuelta_at")
  silenciadaHasta DateTime?   @map("silenciada_hasta")
  notificaciones AlertaNotificacion[]
  @@index([localId, estado, ultimaVezAt])
  @@map("alerta")
}
// SQL: CREATE UNIQUE INDEX ux_alerta_huella_viva ON alerta (huella) WHERE estado IN ('ABIERTA','RECONOCIDA','SILENCIADA');

model AlertaNotificacion { id BigInt @id @default(autoincrement()) alertaId BigInt @map("alerta_id") nivel Int canal String destino String? estado String createdAt DateTime @default(now()) @map("created_at") alerta Alerta @relation(fields: [alertaId], references: [id], onDelete: Cascade) @@index([alertaId, nivel]) @@map("alerta_notificacion") }

model ReporteProgramado {
  id            Int      @id @default(autoincrement())
  localId       Int      @map("local_id")
  nombre        String
  tipo          String                                          // OPERATIVO_DIARIO | SEMANAL_EJECUTIVO | MENSUAL
  frecuencia    String                                          // DIARIO | SEMANAL | MENSUAL
  diaSemana     Int?     @map("dia_semana")
  diaMes        Int?     @map("dia_mes")
  hora          String                                          // "07:00" (zona del local)
  formato       String[] @default(["PDF"])
  destinatarios String[]
  filtros       Json?
  activo        Boolean  @default(true)
  ultimaEjecucionAt DateTime? @map("ultima_ejecucion_at")
  generados     ReporteGenerado[]
  @@map("reporte_programado")
}

model ReporteGenerado {
  id            BigInt   @id @default(autoincrement())
  programadoId  Int      @map("programado_id")
  periodo       String                                          // "2026-W43" | "2026-10-19" | "2026-10"
  archivo       String                                          // ruta relativa en REPORTES_DIR
  bytes         Int
  estado        String                                          // GENERADO | ENVIADO | FALLIDO
  error         String?
  createdAt     DateTime @default(now()) @map("created_at")
  programado    ReporteProgramado @relation(fields: [programadoId], references: [id], onDelete: Cascade)
  @@unique([programadoId, periodo])
  @@map("reporte_generado")
}

// Valoración (N07): valoracion(turno_id unique, estrellas 1..5, comentario, created_at)
```

**Vista materializada (migración `…_m7_analitica`):**
```sql
CREATE MATERIALIZED VIEW mv_turno_franja AS
SELECT t.local_id, t.cola_id, t.fecha,
       EXTRACT(DOW FROM t.fecha)::int                                   AS dow,
       (EXTRACT(HOUR   FROM (t.emitido_at AT TIME ZONE l.zona_horaria)) * 2
        + FLOOR(EXTRACT(MINUTE FROM (t.emitido_at AT TIME ZONE l.zona_horaria)) / 30))::int AS franja,   -- 0..47
       COUNT(*)                                                         AS llegadas,
       COUNT(*) FILTER (WHERE t.estado = 'ATENDIDO')                    AS atendidos,
       COUNT(*) FILTER (WHERE t.estado = 'NO_SE_PRESENTO')              AS no_presentados,
       COUNT(*) FILTER (WHERE t.estado = 'CANCELADO')                   AS cancelados,
       COUNT(*) FILTER (WHERE t.llamado_at IS NOT NULL)                 AS llamados,
       AVG(EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)))           FILTER (WHERE t.llamado_at IS NOT NULL) AS espera_prom_seg,
       percentile_cont(ARRAY[0.5, 0.9, 0.95])
         WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)))
         FILTER (WHERE t.llamado_at IS NOT NULL)                        AS espera_pcts,           -- {p50,p90,p95}
       percentile_cont(ARRAY[0.5, 0.9, 0.95])
         WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.finalizado_at - t.llamado_at)))
         FILTER (WHERE t.estado = 'ATENDIDO' AND t.finalizado_at IS NOT NULL) AS atencion_pcts
  FROM turno t JOIN local l ON l.id = t.local_id
 WHERE t.fecha >= current_date - 180
 GROUP BY 1, 2, 3, 4, 5;
CREATE UNIQUE INDEX ux_mv_turno_franja ON mv_turno_franja (local_id, cola_id, fecha, franja);
-- refresco: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_turno_franja;   (job cada 5 min)
```
*Nota de escala:* los percentiles de una franja no se pueden promediar para obtener el de un rango; para rangos > 1 franja se agregan **muestras** (consulta directa con `percentile_cont` sobre `turno` acotada por fecha) o se usa la MV solo para conteos y promedios y se calcula el percentil del rango con una consulta directa indexada (`ix_turno_localfecha`). La implementación debe elegir según el tamaño del rango (≤ 14 días: directo; > 14 días: MV con aviso "aproximado").

## 6. Diseño de la solución

### 6.1 Percentiles
`percentile_cont(p) WITHIN GROUP (ORDER BY x)` con interpolación lineal (tipo 7). Para `[10,20,30,40,50]`: P50 = 30, P90 = 46, P95 = 48.
Se reportan en minutos con un decimal; se excluyen espera < 0 (datos inconsistentes) y se *winsorizan* esperas > 8 h.

### 6.2 Mapa de calor
Entrada: rango (def. 8 semanas), cola, métrica. Salida: matriz 7 × 16 (6:00–21:00) con `valor`, `n` (muestras) y `confiable = n ≥ 5`. Valores:
- `llegadas`: media por (dow, hora) = `Σ llegadas / nº de ocurrencias de ese dow`.
- `espera_p90`: P90 de las esperas de esa celda (consulta directa por rango).
- `abandono`: `(no_presentados + cancelados) / llegadas`.
Escala secuencial de un solo tono (accesible) + tabla alternativa para lectores de pantalla; tooltip con valor y n.

### 6.3 SLA con censura a la derecha
```sql
WITH base AS (
  SELECT t.id, t.estado,
         (t.llamado_at IS NOT NULL) AS llamado,
         EXTRACT(EPOCH FROM (COALESCE(t.llamado_at, t.finalizado_at, now()) - t.emitido_at)) AS espera_seg
    FROM turno t
   WHERE t.cola_id = $1 AND t.emitido_at >= now() - make_interval(mins => $ventana)
), clasif AS (
  SELECT CASE
           WHEN llamado AND espera_seg <= $max_seg                      THEN 'CUMPLE'
           WHEN llamado AND espera_seg  > $max_seg                      THEN 'INCUMPLE'
           WHEN estado IN ('EMITIDO','AVISADO') AND espera_seg > $max_seg THEN 'INCUMPLE'     -- ya incumplió aunque siga esperando
           WHEN estado IN ('EMITIDO','AVISADO')                         THEN 'PENDIENTE'
           WHEN estado IN ('CANCELADO','NO_SE_PRESENTO') AND espera_seg > $max_seg THEN 'INCUMPLE'
           ELSE 'EXCLUIDO' END AS c,
         espera_seg
    FROM base)
SELECT COUNT(*) FILTER (WHERE c='CUMPLE') AS cumplen,
       COUNT(*) FILTER (WHERE c='INCUMPLE') AS incumplen,
       COUNT(*) FILTER (WHERE c='PENDIENTE' AND espera_seg >= 0.8 * $max_seg) AS en_riesgo
  FROM clasif;
```
`cumplimiento = cumplen / NULLIF(cumplen + incumplen, 0)`. **Presupuesto de error:** permitidos = `(1 − objetivo) × N`; consumido = `incumplen / permitidos`.
Ejemplo de prueba: 6 llamados ≤ 15 min, 2 llamados > 15, 1 en espera con 20 min, 1 en espera con 5 min ⇒ cumplen 6, incumplen 3, pendiente 1 ⇒ **66.7 %**.

### 6.4 Detección de anomalías (estadística robusta)
```
baseline(cola, dow, franja) = valores de `llegadas` de las últimas 8 semanas del mismo dow y franja   (n ≥ 4)
med = mediana ;  MAD = mediana(|x_i − med|) ;  escala = max(MAD, 1)          // piso para MAD = 0 en colas de poco tráfico
fracción = minutos transcurridos de la franja / 30     (solo si ≥ 0.5)
esperado = med × fracción ;   observado = llegadas acumuladas en la franja
z = 0.6745 × (observado − esperado) / (escala × sqrt(fracción))              // z robusto (Iglewicz–Hoaglin)
|z| > 3.5  ⇒ anomalía   (z > 0: "afluencia inusualmente alta"; z < 0: "caída de afluencia")
```
Ejemplo: baseline `[20,22,19,21,23,20,22,21]` ⇒ med = 21, MAD = 1; observado 40 (fracción 1) ⇒ z ≈ 12.8 ⇒ anomalía.
Ídem para espera promedio contra su línea base (anomalía de espera).

### 6.5 Motor de alertas (FSM pura + orquestador)
```
Evaluación (cada 1 min, por local, con pg_try_advisory_lock):
   para cada regla activa: obs = medir(regla)   → { dispara: boolean, detalle }
   estado = cargar contador de rachas (en BD: alerta_racha) 
   avanzar(estado, obs, ahora) → decisión ∈ { NADA, ABRIR, REPETIR(incrementa ocurrencias), RESOLVER, ESCALAR(nivel) }

Reglas de la FSM:
   dispara=true  por 2 evaluaciones seguidas y no hay alerta viva  → ABRIR   (nivel 1, proximoEscalaAt = ahora + niveles[1].traMin)
   dispara=true  con alerta viva                                    → REPETIR (ultimaVezAt = ahora, ocurrencias++)
   dispara=false por `resolverTrasMin` minutos con alerta ABIERTA/RECONOCIDA → RESOLVER (auto)
   ahora ≥ proximoEscalaAt, estado = ABIERTA (no reconocida)         → ESCALAR (nivel++ hasta el máximo)
   estado = RECONOCIDA                                               → no escala
   estado = SILENCIADA y ahora ≥ silenciadaHasta                     → vuelve a ABIERTA si sigue disparando; si no, RESUELTA
   recurrencia ≤ 30 min tras resolver                                → REABRIR la misma huella (anti-flapping), sin renotificar el nivel 1
Notificación: INSERT INTO alerta_notificacion (alerta, nivel, canal) ON CONFLICT … solo 1 por (alerta, nivel) por hora → envía por el canal
```
Todo el estado de alertas vive en BD; la FSM es una **función pura** `avanzar()` ⇒ pruebas deterministas con reloj falso.

### 6.6 Tipos de alerta y medición
| Tipo | Se dispara cuando | Fuente |
|---|---|---|
| `SLA_INCUMPLIDO` | cumplimiento móvil < objetivo (con ≥ 10 muestras) | §6.3 |
| `ESPERA_ALTA` | `espera_max_min` de una cola > umbral | métricas de M6 |
| `COLA_LARGA` | `en_espera` > umbral | idem |
| `ANOMALIA_LLEGADAS` | §6.4 | MV + turno de hoy |
| `VENTANILLA_INACTIVA` | ventanilla activa, cola con espera > 0 y sin llamados en 10 min | `turno`, `ventanilla` |
| `WHATSAPP_CAIDO` | ≥ 3 envíos `FALLIDO` consecutivos o sesión OpenWA desconectada | `notificacion`, `/whatsapp/conexion` |
| `KIOSCO_OFFLINE` | `kiosco:estado` sin *heartbeat* > 75 s (M5) | evento |
| `PREDICCION_DERIVA` | M2 detecta deriva | evento |
| `BALANCEO_LIMITE` | M6 omitió por límite/hora | evento |
| `JOB_FALLIDO` | un job de pg-boss agota reintentos (F1) | `pgboss` |
Las alertas de sistema se evalúan por **evento** (no solo por reloj) y se normalizan al mismo ciclo de vida.

### 6.7 Reportes programados
```
job cada 1 min:
   para cada reporte activo: ¿toca ahora (zona del local, frecuencia, día, hora)?
   periodo = clave del periodo cerrado (ej. "2026-W43")
   INSERT INTO reporte_generado (programado_id, periodo, estado='GENERANDO') ON CONFLICT DO NOTHING RETURNING → si no inserta, ya existe ⇒ salir (idempotente, RN-M7-07)
   datos = consultas (KPIs, SLA, percentiles, heatmap resumido, top alertas, CSAT)
   PDF = renderizar con @react-pdf/renderer (servidor): portada, KPIs, gráficos de barras y heatmap con primitivas <Svg>, tabla de incidentes
   guardar en REPORTES_DIR/{local}/{año}/{id}.pdf ; enviar por correo (SMTP) con PDF/CSV adjunto (si ≤ 5 MB; si no, enlace autenticado)
   marcar ENVIADO / FALLIDO(error) ; reintentos 3 con backoff
```
Sin navegador headless (evita dependencia pesada); fuentes embebidas (Inter).

### 6.8 CSAT (valoración)
Resumen: `promedio`, `% 4–5`, distribución 1–5, y **promedio de estrellas por tramo de espera** (0–5, 5–10, 10–20, 20–30, 30+ min) para mostrar la relación espera ↔ satisfacción. Comentarios solo para ADMIN, sin datos personales.

## 7. API

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/analitica/resumen?desde&hasta&colaId` | ADMIN+ | KPIs + percentiles + SLA |
| GET | `/analitica/heatmap?desde&hasta&colaId&metrica=llegadas\|espera_p90\|abandono` | ADMIN+ | Matriz 7×16 con `n` y `confiable` |
| GET | `/analitica/percentiles?desde&hasta&colaId&agrupar=hora\|dia\|cola` | ADMIN+ | P50/P90/P95 de espera y atención |
| GET | `/analitica/sla` | ADMIN+ | Estado actual por cola (cumplimiento, en riesgo, presupuesto de error) |
| GET | `/analitica/sla/serie?colaId&dias=7` | ADMIN+ | Serie horaria |
| GET | `/analitica/csat?desde&hasta` | ADMIN+ | Resumen de valoraciones |
| GET/PUT | `/sla/:colaId` | ADMIN+ | Configura SLA |
| GET/POST/PATCH/DELETE | `/alertas/reglas[/:id]` | ADMIN+ | Reglas |
| GET | `/alertas?estado&nivel&tipo&cursor` | ADMIN+ | Lista |
| GET | `/alertas/resumen` | ADMIN+ | Conteo para la campana |
| PATCH | `/alertas/:id` | ADMIN+ | `{ accion: "RECONOCER" \| "RESOLVER" \| "SILENCIAR" \| "REABRIR", hasta? }` |
| GET/POST/PATCH/DELETE | `/reportes-programados[/:id]` | ADMIN+ | Programación |
| POST | `/reportes-programados/:id/ejecutar` | ADMIN+ | Ejecuta ahora (periodo actual, marcado manual) |
| GET | `/reportes-generados?programadoId&cursor` | ADMIN+ | Historial |
| GET | `/reportes-generados/:id/descargar` | ADMIN+ | PDF/CSV |
| POST | `/public/turnos/:token/valoracion` | público | Solo turnos ATENDIDO, una vez (N07) |
**Errores:** `M7_SLA_INVALIDO` (422), `M7_REGLA_INVALIDA` (422), `M7_ALERTA_NO_ENCONTRADA` (404), `M7_ESTADO_INVALIDO` (409), `M7_REPORTE_EN_CURSO` (409), `M7_DESTINATARIO_INVALIDO` (422), `M7_SIN_DATOS` (404), `M7_VALORACION_DUPLICADA` (409), `MODULO_NO_DISPONIBLE` (403).
**Eventos en tiempo real:** `alerta:nueva`, `alerta:actualizada` (bus F2) → campana y toast.

## 8. Jobs
| Job | Cron | Qué hace |
|---|---|---|
| `analitica-refrescar-mv` | cada 5 min | `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_turno_franja` (con `singletonKey`) |
| `alertas-evaluar` | cada 1 min | §6.5 por local con *advisory lock* |
| `alertas-escalar` | cada 1 min | Escala las no reconocidas |
| `reportes-programados` | cada 1 min | §6.7 |
| `analitica-limpiar` | `0 4 * * *` | Elimina alertas resueltas > 180 días y reportes > 90 días |

## 9. UI
| Pantalla | Contenido |
|---|---|
| **Analítica** (`/admin/modulos/analitica`) | Barra de filtros (rango, cola); KPIs; **tarjetas de SLA** por cola (medidor + "en riesgo" + presupuesto de error); **mapa de calor** con selector de métrica; **percentiles** (tabla y barras P50/P90/P95); CSAT por tramo de espera; exportación CSV |
| **Alertas** (`/admin/modulos/alertas`) | Lista de alertas activas con nivel, estado, tiempo abierta, ocurrencias y acciones (Reconocer / Resolver / Silenciar); pestaña **Reglas** (umbral, niveles, canales); pestaña **Historial** |
| **Reportes** (`/admin/modulos/reportes`) | Lista de programaciones (próxima ejecución, destinatarios), modal de creación, historial con descarga y estado |
| **Shell del admin** | **Campana** con contador de alertas abiertas, toast al llegar una nueva, enlace directo |
Estados: sin datos suficientes ("necesitas ≥ 4 semanas para anomalías"), sin SLA definido (CTA), error de SMTP (aviso).
Accesibilidad: el mapa de calor incluye tabla equivalente; el color nunca es el único canal (valor y etiqueta).

## 10. Integración con el núcleo
| Archivo | Cambio |
|---|---|
| `reporteEspera` / `/admin/reportes` | Se mantiene; M7 añade percentiles y reutiliza las métricas |
| `src/lib/realtime.ts` | `alerta:*` |
| `src/lib/whatsapp.ts` | Envío de alertas a admins (plantilla simple; cuenta en la cuota) |
| Correo | Nuevo `src/lib/correo.ts` (`nodemailer`, `SMTP_*`) |
| Admin shell | Campana de alertas |
| M2/M5/M6 | Publican eventos que M7 convierte en alertas |
| Super admin | Vista de alertas de sistema (jobs, WhatsApp) |

## 11. Seguridad y privacidad
- Todas las consultas filtran por `localId` de sesión; las alertas del sistema globales solo para SUPER_ADMIN.
- Destinatarios de reportes validados (correo) y limitados a 10; descarga solo autenticada; los PDF no incluyen teléfonos ni nombres.
- Los comentarios de CSAT se muestran sin identificar al cliente y con filtro básico de contenido.
- Auditoría (F4) de cambios en SLA, reglas y programaciones.
- Plantillas de correo con escape de HTML.

## 12. Pruebas
**Unitarias:** percentiles tipo 7 (`[10,20,30,40,50]` ⇒ 30/46/48); clasificación SLA (ejemplo 66.7 %, caso sin muestras, todos pendientes); z robusto (MAD = 0 usa el piso; ejemplo ≈ 12.8); FSM de alertas con **reloj falso**: apertura a la 2.ª evaluación, repetición sin renotificar, escalamiento a los `t2`/`t3`, reconocer detiene, auto‑resolución a los 10 min, anti‑*flapping*, silenciado; deduplicación por huella; cálculo de periodos de reportes (semana ISO, mes, cambio de año); *scheduler* en zona `America/Lima`.
**Propiedades:** 100 disparos en 1 min ⇒ 1 alerta, `ocurrencias = 100`, ≤ 1 notificación por nivel; el cumplimiento está siempre en `[0,1]` y es monótono al mover turnos de INCUMPLE a CUMPLE.
**Integración (BD real):** la MV coincide con la consulta directa sobre el histórico sembrado (F8); `REFRESH … CONCURRENTLY` no bloquea lecturas; 2 instancias evaluando ⇒ una sola alerta (índice único parcial + *lock*); reportes: ejecutar dos veces el mismo periodo ⇒ 1 archivo; PDF no vacío y con el título (`pdf-parse`); correo recibido en Mailpit; valoración duplicada ⇒ 409.
**API/permisos:** OPERADOR sin acceso a analítica; otro local no ve alertas; módulo apagado ⇒ 403.
**E2E (Playwright):** escenario 11 del plan (se abre, escala y se resuelve una alerta SLA con reloj simulado); la campana cambia; descargar un reporte.
**Rendimiento:** heatmap sobre 60 días sembrados < 300 ms; 20 000 turnos por local.
**Accesibilidad:** el mapa de calor y los medidores pasan axe y tienen alternativa textual.

## 13. Observabilidad
`m7_alertas_abiertas{tipo}`, `m7_alertas_total{tipo,nivel}`, `m7_notificaciones_total{canal,resultado}`, `m7_eval_ms`, `m7_mv_refresh_ms`, `m7_reportes_total{estado}`, `m7_sla_cumplimiento{cola}`. El propio módulo alerta si su MV lleva > 15 min sin refrescarse.

## 14. Criterios de aceptación
```gherkin
Escenario: Percentiles
  Dado un local con 60 días de histórico
  Cuando el admin abre Analítica
  Entonces ve P50, P90 y P95 de espera por cola y un mapa de calor de afluencia

Escenario: SLA con turnos en espera
  Dado un SLA de 15 min al 90 % y un turno que ya lleva 20 min esperando
  Entonces ese turno cuenta como incumplimiento aunque aún no haya sido llamado

Escenario: Alerta con escalamiento
  Dado una regla ESPERA_ALTA con niveles 0/10/30 min
  Cuando la espera máxima supera 20 min durante 2 evaluaciones
  Entonces se abre una alerta (campana y toast)
  Y a los 10 min sin reconocer se envía un WhatsApp al admin
  Y al reconocerla se detiene el escalamiento

Escenario: Resolución automática
  Dado una alerta abierta
  Cuando la métrica vuelve a la normalidad durante 10 minutos
  Entonces la alerta se resuelve sola

Escenario: Reporte semanal
  Dado un reporte programado para los lunes 07:00
  Cuando llega el momento
  Entonces se genera un solo PDF para esa semana y se envía a los destinatarios
```

## 15. Riesgos
| Riesgo | Mitigación |
|---|---|
| Fatiga de alertas | Histéresis de 2 evaluaciones, deduplicación, 1 notificación por nivel/hora, silenciado |
| Percentiles de rangos largos costosos | MV para conteos/promedios; percentil por consulta directa en ≤ 14 días; avisar "aproximado" |
| Pocas muestras en colas pequeñas | `confiable = n ≥ 5`, piso de MAD, mínimo de 10 muestras para el SLA |
| PDFs pesados o fuentes | `@react-pdf` sin navegador, fuentes embebidas, límite de 5 MB para adjuntos |
| Correo no configurado | Reportes quedan "GENERADO" con enlace de descarga; aviso en UI |

## 16. Plan de tareas
| ID | Tarea | Horas | Estado |
|---|---|---|---|
| M7-T01 | Modelo y migración (SLA, alertas, reglas, reportes) | 3 | [ ] |
| M7-T02 | Vista materializada, índices, job de refresco y consultas de percentiles/heatmap | 7 | [ ] |
| M7-T03 | SLA con censura a la derecha, ventanas móviles y presupuesto de error + pruebas | 5 | [ ] |
| M7-T04 | Detección de anomalías (MAD) + pruebas | 5 | [ ] |
| M7-T05 | Motor de alertas: FSM pura, deduplicación, escalamiento, canales (in‑app/WhatsApp/correo), alertas de sistema | 9 | [ ] |
| M7-T06 | Reportes programados: PDF (`@react-pdf`), CSV, correo, idempotencia, job | 8 | [ ] |
| M7-T07 | API de analítica, SLA, alertas, reportes, CSAT (zod, permisos, errores) | 6 | [ ] |
| M7-T08 | UI de analítica (heatmap, percentiles, medidores SLA, CSAT) | 5 | [ ] |
| M7-T09 | UI de alertas (campana, lista, reglas) y de reportes | 5 | [ ] |
| M7-T10 | Pruebas de integración/E2E/rendimiento y documentación | 7 | [ ] |
| **Total** | | **60** | |
