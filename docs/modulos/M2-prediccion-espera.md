# M2 · Predicción de espera

**Responsable:** Integrante 1 · **Estimación:** 56 h · **Complejidad:** ●●●●○ · **Plan:** baseline en todos; modelos EMA/estacional en PRO
**Depende de:** F0, F1 (jobs), F5 (columnas `delante_emision`, `ventanillas_activas_emision`), F8 (histórico) · **Alimenta:** M7 (precisión del modelo), M8 (calibración), M4/M5 (estimación al tomar turno)
**Pantallas Figma previstas:** M2a Modelo EMA · M2b Modelo estacional · M2c Cliente: espera estimada con rango

---

## 1. Resumen y objetivo

La estimación actual (`tiempo_estimado(cola, posicion)` = posición × promedio de los últimos 10 atendidos) es una **cifra única**, ignora el
número de ventanillas abiertas, la hora del día y el día de la semana, y no dice cuán confiable es. M2 la reemplaza por una
**predicción con rango de confianza** ("14–22 min, 80 %") que mejora con los datos del propio local y que además:

- se **evalúa honestamente** (validación cronológica sin fuga de datos) y se **monitorea en producción**;
- cae a un modelo simple si no hay datos suficientes (*arranque en frío*);
- informa al cliente **a qué hora conviene venir** y le permite pedir un aviso "10 min antes".

## 2. Alcance

**Incluye:** tres modelos (baseline RN02, EMA, estacional) + selección automática; intervalos por conformalización; evaluación walk-forward;
importancia de variables por permutación; reentrenamiento nocturno e incremental; registro de cada predicción y su resultado real; API y UI;
"mejores horas"; aviso por tiempo estimado.

**No incluye (v1):** modelos de aprendizaje profundo; predicción por categoría de prioridad (M1) o por tipo de trámite; **opcional v2:** regresión *ridge* (`(XᵀX+λI)⁻¹Xᵀy`) como cuarto modelo.

## 3. Actores e historias

| Actor | Historia |
|---|---|
| Cliente | Quiero saber cuánto esperaré **con un rango** y a qué hora hay menos gente, para decidir si espero o vuelvo |
| Cliente | Quiero que me avisen cuando falten ~10 min según el tiempo estimado (no solo cuando falten N personas) |
| Admin | Quiero ver qué tan preciso es el modelo, compararlo con el simple y reentrenarlo |
| Operador | (indirecto) Menos reclamos por tiempos mal informados |
| Sistema | Debo degradarme con elegancia si hay pocos datos o el modelo se desvía |

## 4. Requisitos

**Funcionales**
- **RF-M2-01** Cada turno nuevo recibe una predicción de **tiempo hasta ser llamado** con límite inferior y superior.
- **RF-M2-02** Modelos disponibles: `BASELINE`, `EMA`, `ESTACIONAL`; modo `AUTO` elige el de menor MAE de los últimos 7 días.
- **RF-M2-03** El admin ve MAE, mediana del error, % de aciertos ±5 min, sesgo, cobertura del intervalo y ancho medio, por cola y por modelo.
- **RF-M2-04** El admin puede reentrenar manualmente y configurar α de la EMA, nivel de confianza (80/90 %) y días de entrenamiento.
- **RF-M2-05** Se muestra la **importancia de cada variable** (por permutación) del modelo activo.
- **RF-M2-06** "Mejores horas": espera esperada por franja de 30 min para el resto del día.
- **RF-M2-07** El cliente puede activar "avisarme X min antes" (5/10/15) y recibe aviso cuando la predicción baje de X.
- **RF-M2-08** Cada predicción mostrada se registra y se completa con el valor real al ser llamado (monitoreo continuo).

**Reglas de negocio**
- **RN-M2-01** Se predice **espera = llamado_at − emitido_at**, en segundos; se muestra en minutos redondeados hacia arriba (mín. 1 min; "menos de 1 min" si < 60 s).
- **RN-M2-02** Arranque en frío: `n_servicios < 30` ⇒ BASELINE con `tiempo_atencion_base`; `30 ≤ n < 200` ⇒ EMA; `n ≥ 200` y ≥ 14 días de historia ⇒ ESTACIONAL elegible.
- **RN-M2-03** Muestras de servicio válidas: ATENDIDO con `30 s ≤ finalizado − llamado ≤ 3 600 s`; se *winsorizan* al percentil 99.
- **RN-M2-04** `c` (ventanillas operativas) = ventanillas de la cola con algún llamado en los últimos 15 min o con un turno LLAMADO ahora; mínimo 1.
- **RN-M2-05** Si el MAE de 7 días en producción supera 1.3 × el MAE de validación, se marca **deriva**, se vuelve a BASELINE hasta el siguiente reentrenamiento y se emite alerta (M7).
- **RN-M2-06** El cambio automático de modelo exige ≥ 5 % de mejora de MAE (histéresis para no oscilar).

**No funcionales**
- **RNF-M2-01** Predecir un turno < 5 ms (solo aritmética con parámetros en caché).
- **RNF-M2-02** Reentrenar una cola con 60 días y 20 000 turnos < 10 s.
- **RNF-M2-03** Sin fuga de datos: ninguna predicción usa información posterior a su momento de emisión (prueba de propiedad).

## 5. Diseño de datos

```prisma
enum ModeloPrediccion { BASELINE EMA ESTACIONAL }

model ConfigPrediccion {
  localId           Int              @id @map("local_id")
  modelo            String           @default("AUTO")      // AUTO | BASELINE | EMA | ESTACIONAL
  alfaEma           Decimal          @default(0.2) @db.Decimal(4, 3) @map("alfa_ema")
  nivelConfianza    Decimal          @default(0.8) @db.Decimal(3, 2) @map("nivel_confianza")
  diasEntrenamiento Int              @default(60) @map("dias_entrenamiento")
  @@map("config_prediccion")
}

model ModeloEntrenado {
  id            Int      @id @default(autoincrement())
  localId       Int      @map("local_id")
  colaId        Int      @map("cola_id")
  tipo          ModeloPrediccion
  version       Int
  parametros    Json                       // ver §6.5
  nMuestras     Int      @map("n_muestras")
  mae           Float?                     // validación walk-forward (segundos)
  medae         Float?
  acierto5      Float?   @map("acierto_5")
  sesgo         Float?
  cobertura     Float?
  anchoMedio    Float?   @map("ancho_medio")
  activo        Boolean  @default(false)
  entrenadoAt   DateTime @default(now()) @map("entrenado_at")
  @@unique([colaId, tipo, version])
  @@index([colaId, activo])
  @@map("modelo_entrenado")
}

model PrediccionLog {
  id        BigInt   @id @default(autoincrement())
  turnoId   Int      @unique @map("turno_id")
  colaId    Int      @map("cola_id")
  tipo      ModeloPrediccion
  version   Int
  delante   Int
  c         Int
  predSeg   Int      @map("pred_seg")
  loSeg     Int      @map("lo_seg")
  hiSeg     Int      @map("hi_seg")
  realSeg   Int?     @map("real_seg")      // se completa al llamar el turno
  createdAt DateTime @default(now()) @map("created_at")
  @@index([colaId, createdAt])
  @@map("prediccion_log")
}

// Turno (migración aditiva; las completa emitir_turno() en F5):
//   delanteEmision            Int? @map("delante_emision")
//   ventanillasActivasEmision Int? @map("ventanillas_activas_emision")
//   avisoMinAntes             Int? @map("aviso_min_antes")   // RF-M2-07
```

Consulta de muestras de entrenamiento (por cola):

```sql
SELECT t.id, t.emitido_at, t.llamado_at, t.finalizado_at,
       EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at))::int    AS espera_seg,
       EXTRACT(EPOCH FROM (t.finalizado_at - t.llamado_at))::int AS servicio_seg,
       t.delante_emision, t.ventanillas_activas_emision
  FROM turno t
 WHERE t.cola_id = $1 AND t.fecha >= $2 AND t.llamado_at IS NOT NULL
 ORDER BY t.emitido_at;
```

## 6. Algoritmos

### 6.1 Notación
`k` = personas delante; `c` = ventanillas operativas (RN-M2-04); `s̄` = tiempo de servicio típico (segundos); `d` = día de la semana (0–6);
`b` = franja de 30 min (0–47); `W` = espera predicha hasta ser llamado.

### 6.2 Modelo BASELINE (equivale a RN02)
`W = (k + 1) × promedio(últimos 10 servicios)`; si no hay datos o el promedio < 30 s, `tiempo_atencion_base`.
Se conserva como **piso de seguridad** y como referencia de la mejora.

### 6.3 Modelo EMA
Media móvil exponencial del tiempo de servicio, en orden de finalización:
```
s̄_0 = tiempo_atencion_base
s̄_t = α · x_t + (1 − α) · s̄_{t−1}        con x_t = servicio válido (winsorizado)
W = ((k + 1) / c) · s̄_t
```
Parámetro α ∈ [0.05, 0.5] (def. 0.2). Se actualiza **en línea** al cerrar cada atención.

### 6.4 Modelo ESTACIONAL (estructura × corrección aprendida)
1. **Servicio por (d, b) con contracción hacia la cola** (*shrinkage* empírico-Bayes):
   `s̄_{d,b} = (n·m_{d,b} + κ·m_q) / (n + κ)` con `m_{d,b}` = mediana de servicios de esa franja, `m_q` = mediana de la cola, `n` = muestras, κ = 10.
2. **Predicción estructural:** `W_est = ((k + 1) / c) · s̄_{d,b}`.
3. **Corrección multiplicativa aprendida** `φ_{d,b}`: razón `real / W_est` suavizada con EMA (α_φ = 0.2) y acotada a [0.5, 2].
   `W = φ_{d,b} · W_est`.
4. Franjas sin datos usan el `φ` de la franja vecina más cercana y, en último caso, 1.

### 6.5 Intervalos (conformalización dividida, *split conformal*)
Para el conjunto de calibración (últimos 14 días, no usado para ajustar `s̄` ni `φ`):
```
e_i = real_i / max(pred_i, 30 s)                 // error relativo
lo = pred · Q_{(1−nivel)/2}(e)      hi = pred · Q_{(1+nivel)/2}(e)       // cuantiles tipo 7 (interpolación lineal)
```
Se calculan por (cola, grupo horario {mañana, tarde}) si `n ≥ 50`; si no, por cola con `n ≥ 30`; si no, `[0.65, 1.45]` fijo.
Con nivel 80 % la **cobertura empírica** debe quedar en 75–85 % (se mide y se muestra).

### 6.6 Evaluación sin fuga de datos (replay cronológico)
Dos flujos de eventos ordenados por tiempo: **emisiones** (se predice con el estado actual) y **cierres de atención** (actualizan el estado).
```
estado = estadoInicial()
para evento en orden por timestamp:
    si evento = EMISION:  guardar pred = predecir(estado, k, c, d, b)
    si evento = LLAMADO:  completar real_i = llamado − emisión   (queda disponible solo desde este instante)
    si evento = CIERRE:   actualizar(estado, servicio)
métricas = MAE, MedAE, MAPE robusto (denominador max(real, 120 s)), %|err| ≤ 5 min, sesgo, cobertura, ancho medio
```
Se reporta por modelo y por cola, y se compara con BASELINE: `mejora = 1 − MAE_modelo / MAE_baseline`.

### 6.7 Importancia por permutación
Para cada variable `v ∈ {k, c, franja (b), día (d), φ, s̄}`: se permutan aleatoriamente sus valores entre las muestras de prueba y se mide `ΔMAE`.
`importancia(v) = ΔMAE(v) / Σ ΔMAE` (normalizado a 100 %). Semilla fija para reproducibilidad. Alimenta las barras de la UI.

### 6.8 Selección AUTO y deriva
```
cada noche: entrenar los 3 modelos → MAE_7d de cada uno (replay) →
   elegir mejor; cambiar solo si mejora ≥ 5 % sobre el activo (RN-M2-06)
en producción: MAE_7d(real vs predicción registrada) > 1.3 × MAE_validación ⇒ deriva ⇒ BASELINE + alerta
```

### 6.9 Tiempo hasta el aviso "X min antes"
`ttc = predecir(estado, k_actual, c_actual, ahora)`; si `ttc ≤ avisoMinAntes·60` y no se avisó, se envía el aviso (reutiliza plantilla `turno_proximo` con el tiempo). Se reevalúa en cada `cola:actualizada` y por job cada minuto.

### 6.10 Mejores horas
Espera media real por (d, b) en las últimas 8 semanas, suavizada con media móvil de 3 franjas y contracción hacia la media de la cola; se devuelve el resto del día con nivel `baja` (< P33), `media`, `alta` (> P66).

## 7. API

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/public/turnos/:token` | público | Añade `prediccion: { segundos, loSeg, hiSeg, confianza, modelo, enfrio }`; `tiempoEstimadoSeg` se mantiene (= predicción) por compatibilidad |
| GET | `/public/locales/:slug/estado` | público | `colas[].tiempoEstimadoSeg` pasa a usar el modelo con `k = enEspera` |
| GET | `/public/locales/:slug/mejores-horas?colaId=` | público | `[{ franja:"11:30", esperaMin: 8, nivel:"baja" }]` |
| PATCH | `/public/turnos/:token/aviso` | público | `{ minAntes: 5 \| 10 \| 15 \| null }` |
| GET | `/prediccion/metricas?colaId&dias=14` | ADMIN+ | Métricas por modelo, serie real vs predicho, importancia, estado de deriva |
| GET | `/prediccion/config` · PUT | ADMIN+ | α, nivel de confianza, días de entrenamiento, modo |
| POST | `/prediccion/reentrenar` | ADMIN+ | `{ colaId? }` ⇒ encola job; responde `{ jobId }` |
| GET | `/prediccion/reentrenar/:jobId` | ADMIN+ | Estado y resultado (MAE antes → después) |

**Ejemplo (extracto de `GET /public/turnos/:token`)**
```json
{ "posicion": 4, "personasDelante": 3,
  "prediccion": { "segundos": 1080, "loSeg": 840, "hiSeg": 1320, "confianza": 0.8, "modelo": "ESTACIONAL", "enfrio": false } }
```
**Errores:** `M2_SIN_DATOS` (409), `M2_MODELO_INVALIDO` (422), `M2_ENTRENAMIENTO_EN_CURSO` (409), `M2_AVISO_INVALIDO` (422).
Cache: parámetros del modelo activo en memoria 30 s por cola (se invalida al reentrenar).

## 8. Jobs y eventos
| Job | Cron | Qué hace |
|---|---|---|
| `prediccion-reentrenar` | `0 2 * * *` | Entrena BASELINE/EMA/ESTACIONAL por cola, replay, guarda `ModeloEntrenado`, aplica AUTO |
| `prediccion-flush` | cada 60 s | Persiste parámetros actualizados en línea (EMA, φ) |
| `prediccion-deriva` | cada 10 min | Calcula MAE_7d de producción y detecta deriva |
| `prediccion-avisos` | cada 60 s | Evalúa "aviso X min antes" |

Evento `prediccion:modelo` (cambio de modelo o deriva) para la UI de admin.

## 9. UI
| Ruta | Contenido |
|---|---|
| `/admin/modulos/prediccion` | Pestañas **Modelo EMA · Modelo estacional · Vista del cliente**; KPIs (MAE, aciertos ±5 min, muestras, último entrenamiento); gráfico **real vs predicho** con banda de confianza; chips de algoritmo; barras de importancia; botón **Reentrenar ahora** (toast con MAE antes → después); indicador de deriva |
| `/t/[token]` | Tarjeta "Tu espera estimada ~18 min (14–22)", histograma de la distribución, "mejores horas", interruptor **Avisarme X min antes** |
| `/l/[slug]` | En la elección de cola, "~25 min" calculado con el modelo |
Estados: sin datos (muestra "Estimación inicial"), cargando, entrenando (progreso), error.

## 10. Integración con el núcleo
| Archivo | Cambio |
|---|---|
| `src/lib/turnos.ts` · `tiempoEstimado` | Delegar en `prediccion.service.predecir()`; mantener SQL `tiempo_estimado` como respaldo |
| `emitirTurno` | Tras emitir: calcular y guardar `PrediccionLog` y `delante_emision`/`ventanillas_activas_emision` (vía F5) |
| `llamarSiguiente` / `cambiarEstadoTurno` | Al LLAMADO completar `real_seg`; al ATENDIDO actualizar el estado en línea |
| `revisarAvisos` | Considerar `aviso_min_antes` además de `avisarFaltando` |
| `snapshotLocal` | `tiempoEstimadoSeg` con el modelo |

## 11. Seguridad y privacidad
Sin datos personales en los modelos ni en el log de predicciones (solo agregados por cola). Endpoints públicos con rate limit. `PUT /prediccion/config` auditado.

## 12. Pruebas
**Unitarias:** EMA exacta contra la recurrencia manual; cuantiles tipo 7 contra valores de referencia (p. ej. `[1,2,3,4,5]` ⇒ Q0.1 = 1.4, Q0.9 = 4.6); winsorización; shrinkage (n = 0 ⇒ `m_q`; n → ∞ ⇒ `m_{d,b}`); acotado de φ; `c = 0` ⇒ 1; `k = 0`.
**Propiedades:** (1) **sin fuga**: alterar datos futuros no cambia predicciones pasadas; (2) monotonía: más personas delante ⇒ predicción mayor o igual; (3) más ventanillas ⇒ predicción menor o igual; (4) `lo ≤ pred ≤ hi`.
**Estadísticas con datos sintéticos (semilla fija):** generador con llegadas Poisson y servicio log-normal con media estacional conocida ⇒ ESTACIONAL mejora ≥ 10 % de MAE a EMA y EMA a BASELINE; cobertura del intervalo al 80 % ∈ [0.75, 0.85]; con 20 servicios el sistema usa BASELINE.
**Integración:** el job entrena y deja `ModeloEntrenado` activo; AUTO respeta la histéresis del 5 %; deriva fuerza BASELINE; `real_seg` se completa al llamar.
**API:** contratos y permisos; `PATCH …/aviso` con valores inválidos.
**E2E:** el cliente ve el rango, activa el aviso y lo recibe (con reloj simulado).
**Carga:** 200 predicciones/s sin degradar `llamarSiguiente`.

## 13. Observabilidad
`m2_prediccion_ms`, `m2_mae_7d{cola}`, `m2_cobertura_7d{cola}`, `m2_modelo_activo{cola}`, `m2_deriva_total`. Log del entrenamiento: modelo, n, MAE, mejora, duración.

## 14. Criterios de aceptación
```gherkin
Escenario: Rango de espera
  Dado un local con 30 días de histórico y modelo ESTACIONAL activo
  Cuando un cliente emite un turno con 3 personas delante y 2 ventanillas operativas
  Entonces ve una espera estimada con rango (p. ej. "14–22 min") y el nombre del modelo

Escenario: Arranque en frío
  Dado una cola nueva con 12 atenciones registradas
  Cuando se emite un turno
  Entonces se usa BASELINE y la UI muestra "Estimación inicial"

Escenario: Detección de deriva
  Dado un modelo con MAE de validación 2 min
  Cuando el MAE de los últimos 7 días en producción es 3 min
  Entonces se vuelve a BASELINE y se crea una alerta

Escenario: Aviso por tiempo
  Dado un cliente con "avisarme 10 min antes"
  Cuando la predicción de su turno baja a 10 minutos
  Entonces recibe un único aviso por WhatsApp
```

## 15. Riesgos
| Riesgo | Mitigación |
|---|---|
| Pocos datos en locales nuevos | Arranque en frío + contracción hacia la cola + mostrar "estimación inicial" |
| Estimaciones demasiado optimistas generan reclamos | El intervalo y el sesgo se muestran y se monitorean; α y nivel configurables |
| `c` mal estimado (operadores que no registran actividad) | Definición operativa RN-M2-04 y alerta si `c` cambia bruscamente |
| Sobrecarga de cálculo | Parámetros en caché; predicción aritmética O(1) |

## 16. Plan de tareas
| ID | Tarea | Horas | Estado |
|---|---|---|---|
| M2-T01 | Migración (tablas §5, columnas en `turno`) y captura de `delante`/`c` en la emisión | 4 | [ ] |
| M2-T02 | Utilidades estadísticas (cuantiles, winsorización, PRNG con semilla) + pruebas | 3 | [ ] |
| M2-T03 | Modelos BASELINE/EMA/ESTACIONAL y actualización en línea + pruebas unitarias | 10 | [ ] |
| M2-T04 | Intervalos por conformalización + cobertura | 4 | [ ] |
| M2-T05 | Replay y evaluación walk-forward + métricas + comparación | 8 | [ ] |
| M2-T06 | Importancia por permutación | 3 | [ ] |
| M2-T07 | Jobs (reentrenar, flush, deriva), AUTO con histéresis, caché | 6 | [ ] |
| M2-T08 | API pública y de admin (zod, permisos, errores) | 6 | [ ] |
| M2-T09 | Integración con `turnos.ts` y aviso "X min antes" | 4 | [ ] |
| M2-T10 | UI admin y UI cliente (rango, histograma, mejores horas, aviso) + E2E | 8 | [ ] |
| **Total** | (las pruebas de cada tarea están incluidas) | **56** | |
