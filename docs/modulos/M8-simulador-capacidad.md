# M8 · Simulador de capacidad (Erlang C + simulación de eventos discretos)

**Responsable:** Integrante 4 · **Estimación:** 52 h · **Complejidad:** ●●●●● · **Plan:** PRO
**Depende de:** F0, F3, F8 (histórico) · **Se calibra con:** M7 (`mv_turno_franja`), M2 (definición de ventanillas operativas y tiempos de servicio) · **Alimenta:** M6 (qué reglas conviene), reportes de M7
**Pantallas Figma previstas:** M8a Escenario con 3 ventanillas (no cumple el SLA) · M8b Escenario con 4 ventanillas (cumple el SLA)

---

## 1. Resumen y objetivo

La pregunta del dueño del local es: **"¿cuántas ventanillas necesito en hora punta para que casi todos esperen menos de X minutos?"** Responderla "a ojo" lleva a sobredimensionar (costo) o subdimensionar (colas).
M8 es una herramienta de **dimensionamiento** con dos motores que se validan entre sí:

1. **Modelo analítico (Erlang C, M/M/c):** respuesta instantánea y exacta bajo supuestos de régimen estacionario.
2. **Simulación de eventos discretos (DES) + Monte Carlo:** respeta lo que Erlang C no puede —llegadas que cambian cada 30 min, horarios escalonados, abandono, *no-show* (RN04), servicio no exponencial— y entrega **intervalos de confianza**.

Se **calibra con el histórico real** del local y se **valida** reproduciendo días pasados.

## 2. Alcance

**Incluye:** fórmulas de Erlang B/C numéricamente estables; búsqueda del mínimo de ventanillas que cumple un SLA; DES con llegadas Poisson no homogéneas (adelgazamiento), servicio exponencial/log‑normal/empírico, paciencia (abandono) y *no‑show*; calendario de ventanillas `c(t)`; réplicas Monte Carlo con semillas reproducibles y **números aleatorios comunes (CRN)**; intervalos de confianza; comparación de escenarios; análisis de sensibilidad (tornado); modelo de costos; calibración y *backtest* con histórico; guardado/duplicado de escenarios; ejecución en **Web Worker**.

**No incluye (v1):** optimización matemática de turnos de personal, múltiples colas con compartición de ventanillas (red de colas), clases de prioridad (stretch con M1), previsión de demanda futura (lo hace M2).

## 3. Actores e historias

| Actor | Historia |
|---|---|
| Admin | Pruebo "¿qué pasa si agrego una ventanilla de 10:00 a 13:00?" y veo la espera esperada y su rango |
| Admin | Obtengo "mínimo 4 ventanillas para cumplir el 90 % ≤ 15 min" con su costo |
| Admin | Veo si mi SLA es alcanzable con el personal actual y qué tan sensible es a la demanda |
| Admin | Confío en el modelo porque reproduce lo que pasó los últimos 14 días |
| Equipo (docente) | Puede ver la teoría de colas aplicada y validada |

## 4. Requisitos

**Funcionales**
- **RF-M8-01** Parámetros: λ (clientes/hora o curva por franja de 30 min), distribución del servicio (media y CV; o log‑normal; o empírica), nº de ventanillas `c` (constante o por franja), horario, paciencia (opcional), % de *no‑show* y su duración, SLA (espera máxima y objetivo %).
- **RF-M8-02** Resultado **analítico** instantáneo: `ρ`, `P(esperar)`, `Wq`, `P(Wq > t)`, percentil de espera, nivel de servicio, y aviso de **inestabilidad** si `ρ ≥ 1`.
- **RF-M8-03** Resultado **simulado** con R réplicas (def. 1 000): media, P50/P90/P95 de espera, % que cumple el SLA, utilización, cola máxima, abandono %, *backlog* al cierre; todos con **IC 95 %**.
- **RF-M8-04** **Recomendación**: mínimo `c` (constante y por franja) que cumple el SLA con `ρ ≤ ρ_max` (def. 0.85), verificado con DES.
- **RF-M8-05** **Comparación** de 2–5 escenarios (p. ej. c = 3, 4, 5) con diferencias **pareadas** (CRN) e IC de la diferencia.
- **RF-M8-06** **Sensibilidad (tornado):** efecto de λ ± 20 %, servicio ± 20 % y c ± 1 sobre el nivel de servicio.
- **RF-M8-07** **Costos:** costo por ventanilla‑hora y (opcional) costo por cliente‑minuto de espera ⇒ escenario de costo mínimo.
- **RF-M8-08** **Calibración** desde el histórico (λ por franja, distribución del servicio, ventanillas operativas, *no‑show*, abandono) con indicador de **confianza** (n de muestras).
- **RF-M8-09** **Backtest:** simula días pasados con sus datos reales y compara espera media y P90 simulados vs observados (error %).
- **RF-M8-10** Guardar, duplicar y exportar escenarios (CSV/PDF); ejecución con progreso y **cancelación**.

**Reglas de negocio**
- **RN-M8-01** Estabilidad: el modelo analítico exige `λ < cμ`; si no, se informa "sistema inestable: la cola crece sin límite" y se muestra la simulación (que sí muestra el *backlog*).
- **RN-M8-02** Unidades: tiempos en **minutos**, tasas en **clientes/minuto** internamente; la UI usa clientes/hora.
- **RN-M8-03** La simulación es **reproducible**: misma semilla ⇒ mismos resultados exactos; se muestra la semilla.
- **RN-M8-04** El modo `DIA` parte de cola vacía a la apertura; el modo `ESTACIONARIO` usa λ constante y descarta un **calentamiento** (10 % o 30 min).
- **RN-M8-05** El *no‑show* modela RN04: con probabilidad `pNS` el cliente llamado no se presenta y la ventanilla pierde `tNS` min (def. 3).
- **RN-M8-06** Al reducir `c(t)` una ventanilla **termina su atención en curso** antes de cerrar (sin interrupciones).
- **RN-M8-07** La recomendación nunca propone `c` menor a 1 ni mayor al máximo de ventanillas del plan del local (se avisa si el plan no alcanza).

**No funcionales**
- **RNF-M8-01** 1 000 réplicas de un día (≈ 600 clientes) < 3 s en un portátil; la UI no se congela (Web Worker).
- **RNF-M8-02** Erlang C estable hasta `c = 200` y `a = 190` sin desbordes numéricos.
- **RNF-M8-03** Diferencia entre DES (régimen estacionario) y Erlang C ≤ 5 % en `Wq` con R = 1 000.

## 5. Diseño de datos

M8 es casi **sin estado en servidor**: el cálculo ocurre en el navegador. Solo se guardan escenarios.

```prisma
model EscenarioSimulacion {
  id         Int      @id @default(autoincrement())
  localId    Int      @map("local_id")
  colaId     Int?     @map("cola_id")
  nombre     String
  parametros Json                                  // ver §6.1
  resultados Json?                                 // resumen (no las réplicas completas)
  semilla    Int
  createdBy  Int?     @map("created_by")
  createdAt  DateTime @default(now()) @map("created_at")
  @@index([localId, createdAt])
  @@map("escenario_simulacion")
}
```

### 5.1 Parámetros (JSON versionado)
```json
{ "version": 1, "modo": "DIA", "horario": { "apertura": "08:00", "cierre": "17:00" },
  "lambdaPorHora": [ { "desde": "08:00", "valor": 24 }, { "desde": "10:00", "valor": 42 }, { "desde": "13:00", "valor": 30 } ],
  "servicio": { "tipo": "LOGNORMAL", "mediaMin": 5.0, "cv": 0.6 },
  "ventanillas": [ { "desde": "08:00", "c": 3 }, { "desde": "10:00", "c": 4 } ],
  "pacienciaMin": { "tipo": "EXPONENCIAL", "media": 25 }, "noShow": { "p": 0.08, "minutos": 3 },
  "sla": { "esperaMaxMin": 15, "objetivoPct": 90 },
  "costos": { "ventanillaHora": 12.5, "esperaMinuto": 0.4 }, "replicas": 1000, "semilla": 2026 }
```

## 6. Diseño de la solución

### 6.1 Notación y módulo analítico (Erlang C)
`λ` = tasa de llegadas (clientes/min), `μ = 1/E[S]` = tasa de servicio por ventanilla, `a = λ/μ` (Erlangs), `ρ = a/c`.
**Fórmula directa (peligrosa numéricamente):** `C(c,a) = [a^c/c! · c/(c−a)] / [Σ_{k=0}^{c−1} a^k/k! + a^c/c! · c/(c−a)]` — con `c` grande, `a^c` y `c!` desbordan.
**Implementación estable (recursión de Erlang B):**
```
B_0 = 1
B_k = a·B_{k−1} / (k + a·B_{k−1})          para k = 1…c
C   = B_c / (1 − ρ·(1 − B_c))              (válido si ρ < 1)
```
Métricas:
```
P(esperar)  = C
Wq          = C / (cμ − λ)                          (espera media en cola)
W           = Wq + 1/μ                              (tiempo en el sistema)
Lq          = λ·Wq
P(Wq > t)   = C · exp(−(cμ − λ)·t)
Nivel de servicio SL(t) = 1 − C·exp(−(cμ − λ)·t)    (fracción con espera ≤ t)
Percentil q de la espera: t_q = max(0, ln(C/(1−q)) / (cμ − λ))
```
**Mínimo de ventanillas para un SLA (`t`, objetivo `p`):** probar `c = ⌊a⌋ + 1, ⌊a⌋ + 2, …` hasta que `SL(t) ≥ p` **y** `ρ ≤ ρ_max` (tope 200).
Por franja de 30 min, se aplica el mismo cálculo con el `λ` de cada franja (aproximación casi‑estacionaria) y luego se **verifica con DES** el calendario completo.

### 6.2 Motor de simulación (DES)
Estado: cola FIFO de clientes (`llegada`, `paciencia`), ventanillas (`libre`/`ocupada`/`cerrando`), reloj, **montículo binario** de eventos `(tiempo, seq, tipo, datos)`.
Eventos: `LLEGADA`, `FIN_SERVICIO`, `ABANDONO`, `CAMBIO_C`, `CIERRE`.
```
inicializar RNG por flujos (llegadas, servicio, paciencia, noShow)
programar primera LLEGADA (adelgazamiento) y CAMBIO_C de cada tramo
mientras monticulo no vacío y tiempo ≤ cierre + drenaje:
   e = extraer mínimo
   LLEGADA : programar la siguiente (Poisson no homogéneo); si hay ventanilla libre → iniciar servicio; sino encolar y programar ABANDONO (si hay paciencia)
   FIN_SERVICIO: registrar atención; liberar ventanilla; si c(t) < ocupadas ⇒ cerrar; sino tomar el siguiente de la cola
        al tomar un cliente: con prob. pNS "no se presenta" ⇒ la ventanilla queda ocupada tNS min y luego sigue con el siguiente; registrar no-show
   ABANDONO: si el cliente sigue en cola ⇒ quitarlo; registrar abandono
   CAMBIO_C: abrir ventanillas libres (tomando de la cola) o marcar para cierre
registrar al final: esperas, utilización (tiempo ocupado / tiempo disponible), cola máxima, longitud media ponderada en el tiempo, backlog
```
**Llegadas no homogéneas (adelgazamiento de Lewis–Shedler):** `λ_max = max λ(t)`; `t ← t + Exp(λ_max)`; aceptar con prob. `λ(t)/λ_max`.
**Distribuciones del servicio:** exponencial (`−ln U · media`); **log‑normal** (`exp(μ_ln + σ_ln·Z)` con `Z` por Box–Muller; `σ_ln² = ln(1 + cv²)`, `μ_ln = ln(media) − σ_ln²/2`); **empírica** (remuestreo con reemplazo del historial real).
**PRNG:** `mulberry32` (rápido, 32 bits) con **semillas por flujo** `seed_i = hash32(semillaBase, réplica, idFlujo)` (SplitMix); cada fuente de aleatoriedad usa su flujo ⇒ habilita CRN.

### 6.3 Monte Carlo, CRN e intervalos
```
para r = 1…R:  resultados_r = DES(parametros, semilla_r)      // semilla_r depende de (semillaBase, r)
resumen(métrica) = media_r, desv_r, IC95% = media ± t_{0.975,R−1}·desv/√R           (normal si R ≥ 30)
```
**Números aleatorios comunes:** al comparar escenarios A y B se usan las **mismas semillas por réplica y por flujo**, de modo que ambos ven **las mismas llegadas y tiempos de servicio**; la diferencia `D_r = B_r − A_r` tiene menor varianza que con semillas independientes ⇒ IC de la diferencia más estrecho.
Se guardan por réplica: media de espera, P90, `% ≤ SLA`, utilización, abandono; y se agrupan los **valores de espera** en un histograma (bins de 1 min, hasta 60+).

### 6.4 Calibración desde el histórico
```
GET /simulador/calibracion?colaId&dias=28&tipoDia=laborable
   λ por franja  = promedio de `llegadas` de mv_turno_franja (M7) por (franja) para los días del tipo → llegadas/hora
   servicio      = muestras (finalizado − llamado) de ATENDIDO válidos (M2/RN-M2-03) → media, CV, mediana, P90, ajuste log‑normal (μ_ln, σ_ln por máxima verosimilitud = media y desv. de ln x)
   c(t) por franja = mediana de ventanillas operativas (definición RN-M2-04) en esa franja
   noShow = % NO_SE_PRESENTO ; paciencia = media de espera de los CANCELADO (estimador sesgado a la baja: se advierte)
   confianza: alta (n ≥ 300), media (100–299), baja (< 100) ⇒ se muestra en la UI
```
### 6.5 Backtest (validación del modelo)
Para cada uno de los últimos 14 días: DES con **λ(t) y c(t) reales de ese día** y la distribución de servicio calibrada (R = 200) ⇒ espera media y P90 simulados vs observados. Reporte: **error relativo medio** y % de días con error ≤ 15 %. Si el error medio supera 25 % se avisa "el modelo no reproduce bien tu operación" (posibles causas: servicio multimodal, ventanillas no registradas).

### 6.6 Sensibilidad (tornado)
Para cada factor `f ∈ {λ×0.8, λ×1.2, servicio×0.8, servicio×1.2, c−1, c+1}`: DES (R = 200, **CRN**) ⇒ `ΔSL` respecto del caso base. Se ordenan por |ΔSL| y se muestran barras.

### 6.7 Costos
`costoTotal = Σ_t c(t)·costoVentanillaHora·Δt + (Σ espera_i)·costoEsperaMinuto`. Se calcula por réplica y se promedia; el escenario de **costo mínimo** que cumple el SLA se resalta.

### 6.8 Web Worker
`simulador.worker.ts` recibe `{ tipo: "EJECUTAR", parametros, replicas, semilla }` y emite `{ tipo: "PROGRESO", pct, parcial }` cada 5 % y `{ tipo: "RESULTADO", ... }` al terminar; acepta `{ tipo: "CANCELAR" }`. Los arreglos grandes se transfieren como `Float64Array`. Hook `useSimulacion()` en el cliente. **Respaldo:** si no hay Worker, se ejecuta en el hilo principal por tandas con `setTimeout(0)`. (Verificar en la documentación de Next 16/Turbopack la forma soportada de importar Workers.)

## 7. API (mínima, el cálculo vive en el cliente)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/simulador/calibracion?colaId&dias=28&tipoDia` | ADMIN+ | Parámetros calibrados + confianza |
| GET | `/simulador/backtest?colaId&dias=14` | ADMIN+ | Datos reales por día (λ(t), c(t), espera media y P90 observadas) para que el cliente simule y compare |
| GET/POST | `/simulador/escenarios` | ADMIN+ | Lista / crea |
| GET/PATCH/DELETE | `/simulador/escenarios/:id` | ADMIN+ | Lee / renombra / elimina |
| POST | `/simulador/escenarios/:id/duplicar` | ADMIN+ | Copia |
**Errores:** `M8_PARAMETROS_INVALIDOS` (422), `M8_SIN_DATOS` (409, "no hay suficiente histórico para calibrar"), `M8_LIMITE_ESCENARIOS` (402, 20 por local), `MODULO_NO_DISPONIBLE` (403).
*Opcional (stretch):* `POST /simulador/ejecutar` en servidor con `R ≤ 2000` y *job* para incluir resultados en reportes de M7.

## 8. Jobs
Ninguno obligatorio. Opcional: `simulador-recalibrar` semanal que guarda la calibración en caché para abrir la pantalla al instante.

## 9. UI
`/admin/modulos/simulador`:
| Zona | Contenido |
|---|---|
| **Parámetros** | Sliders/campos: llegadas por hora (curva editable por franjas), servicio (media y CV), ventanillas (**stepper − / +** y calendario), paciencia, no‑show, SLA (espera máx. y %), semilla, réplicas. Botón **"Cargar del histórico"** (calibración) con indicador de confianza |
| **Resultado analítico** | Tarjetas: utilización ρ, P(esperar), espera media, P90, % cumple SLA; **semáforo** "Cumple / No cumple"; aviso de inestabilidad |
| **Resultado simulado** | Mismas métricas con **IC 95 %**; **histograma de esperas**; gráfico **SL vs nº de ventanillas** (curva Erlang) con el punto actual; progreso y botón Cancelar |
| **Comparar** | Tabla c = 2…8 (ρ, Wq, P90, SL, costo) con el mínimo que cumple resaltado; diferencias pareadas con IC |
| **Sensibilidad** | Gráfico de barras tipo tornado |
| **Backtest** | Tabla por día: observado vs simulado, error %, veredicto |
| **Escenarios** | Guardar, duplicar, exportar CSV/PDF |
Prototipo: **M8a** (c = 3 ⇒ "No cumple": SL ≈ 84 %) y **M8b** (c = 4 ⇒ "Cumple": SL ≈ 99.6 %) enlazados por el stepper `+`/`−`.
Valores de referencia (λ = 30 clientes/h = 0.5/min, servicio medio 5 min ⇒ μ = 0.2/min, a = 2.5 Erlangs, SLA 15 min):
`c = 3`: ρ = 0.833, C ≈ 0.702, `P(W>15) = C·e^{−(0.6−0.5)·15} ≈ 0.157` ⇒ SL ≈ 84.3 %;
`c = 4`: ρ = 0.625, C ≈ 0.320, `P(W>15) ≈ 0.0036` ⇒ SL ≈ 99.6 %. Sirven también como vectores de prueba (tolerancia 0.005).
Accesibilidad: gráficos con tabla equivalente; semáforo con texto; foco en el stepper; estados cargando/cancelado/error.

## 10. Integración con el núcleo
| Pieza | Relación |
|---|---|
| `mv_turno_franja` (M7) | Fuente de λ por franja; si M7 no está activo, consulta directa a `turno` |
| Definición de ventanillas operativas (M2) | Para `c(t)` histórico |
| `Plan.maxVentanillas` | Tope de la recomendación (RN-M8-07) |
| M6 | El admin puede traducir la recomendación en reglas de balanceo (enlace "Crear regla a partir de este escenario") |
| M7 | El SLA configurado se propone como valor por defecto del simulador |

## 11. Seguridad y privacidad
Solo agregados (sin datos personales). Los endpoints filtran por `localId`. Se limitan `replicas` (≤ 5 000), tamaño de `parametros` (≤ 20 KB) y escenarios por local; validación con zod y límites para evitar bucles/consumo excesivo en el navegador.

## 12. Pruebas
**Analíticas (valores conocidos):**
- `c = 1, λ = 0.5, μ = 1` ⇒ `C = 0.5`, `Wq = 1` (M/M/1).
- `c = 2, λ = 1, μ = 1` ⇒ `C = 1/3`, `Wq = 1/3`, `P(Wq > 1) = (1/3)·e⁻¹ ≈ 0.1226`.
- `c = 10, a = 8` ⇒ `C ≈ 0.409` (tolerancia 0.002); `c = 200, a = 190` ⇒ sin `NaN`/`Infinity`.
- Propiedades: `SL` crece y `Wq` decrece con `c`; `C ∈ [0,1]`; `ρ ≥ 1` ⇒ error controlado; mínimo `c` es el menor que cumple.
**Estadísticas del DES:**
- Convergencia: `c = 2, λ = 1, μ = 1`, servicio exponencial, régimen estacionario (calentamiento), R = 1 000 ⇒ `Wq` simulado dentro del 5 % de 0.333 y `P(esperar)` dentro del 5 % de 1/3.
- Reproducibilidad: misma semilla ⇒ resultados idénticos bit a bit; semillas distintas ⇒ distintos.
- Adelgazamiento: conteo medio de llegadas ≈ ∫λ(t)dt (±2 %).
- Montículo: orden correcto con 10⁵ eventos; empates por `seq`.
- Abandono: con paciencia infinita el resultado coincide con el modelo sin abandono; con paciencia corta el abandono % crece.
- *No‑show*: aumenta la espera de forma monótona con `pNS`.
- Cierre de ventanillas sin interrumpir atenciones.
- **CRN:** la varianza de `B−A` con semillas comunes < la de semillas independientes (prueba sobre 30 pares).
- Ajuste log‑normal: con 10 000 muestras recupera `(μ, σ)` en ±2 %.
**Calibración y backtest:** con datos sintéticos de verdad conocida (F8) el backtest da error < 10 %; con histórico insuficiente devuelve `M8_SIN_DATOS`.
**Worker:** protocolo de mensajes (progreso, resultado, cancelar) y que la UI no se bloquea (la tarea principal < 50 ms por tanda en la prueba de rendimiento).
**E2E (Playwright):** escenario 12 del plan — con c = 3 se ve "No cumple", al pulsar `+` pasa a c = 4 y se ve "Cumple"; recomendación coincide con la tabla; cancelar una ejecución; guardar y reabrir un escenario.
**Rendimiento:** 1 000 réplicas de un día < 3 s; 200 réplicas del tornado < 1.5 s.

## 13. Observabilidad
Métricas de cliente opcionales (`m8_simulacion_ms`, `m8_replicas`), registradas en servidor solo al guardar un escenario. El resumen guardado incluye versión del motor para reproducir resultados.

## 14. Criterios de aceptación
```gherkin
Escenario: Mínimo de ventanillas
  Dado λ = 30 clientes/hora, servicio medio 5 min y SLA de 90 % en 15 min
  Cuando el admin pulsa "Recomendar"
  Entonces el sistema propone 4 ventanillas (con 3 el nivel de servicio es ≈ 84 %)
  Y lo verifica con simulación mostrando el SLA con su intervalo de confianza

Escenario: Sistema inestable
  Dado λ = 60 clientes/hora, servicio 5 min y 4 ventanillas (ρ ≥ 1)
  Entonces se muestra "Sistema inestable" y la simulación evidencia el backlog al cierre

Escenario: Reproducibilidad
  Dado la semilla 2026
  Cuando se ejecuta dos veces el mismo escenario
  Entonces los resultados son idénticos

Escenario: Comparación
  Dado los escenarios c = 3 y c = 4
  Cuando se comparan
  Entonces se muestra la mejora del SLA con su intervalo de confianza pareado

Escenario: Validación con el pasado
  Dado el histórico de 14 días
  Cuando se ejecuta el backtest
  Entonces se muestra el error de espera media y P90 por día y un veredicto del modelo
```

## 15. Riesgos
| Riesgo | Mitigación |
|---|---|
| El servicio real no es exponencial ⇒ Erlang C se equivoca | DES con log‑normal/empírica + comparación explícita Erlang vs DES |
| Histórico insuficiente | Indicador de confianza, valores por defecto editables, `M8_SIN_DATOS` |
| Desbordes numéricos | Recursión de Erlang B; pruebas con `c = 200` |
| UI congelada | Web Worker y tandas; límite de réplicas |
| Resultados no reproducibles | PRNG con semillas por flujo y versión del motor guardada |
| Malinterpretar ρ y percentiles | Textos de ayuda; avisos de estabilidad; IC visibles |

## 16. Plan de tareas
| ID | Tarea | Horas | Estado |
|---|---|---|---|
| M8-T01 | Modelo `escenario_simulacion`, permisos y esquema zod de parámetros | 2 | [ ] |
| M8-T02 | Erlang B/C estable, métricas, percentiles, inversa (mínimo `c`) + pruebas con valores conocidos | 6 | [ ] |
| M8-T03 | PRNG por flujos, distribuciones (exp, log‑normal, empírica), adelgazamiento | 5 | [ ] |
| M8-T04 | DES: montículo de eventos, ventanillas `c(t)`, abandono, *no‑show*, métricas por réplica | 10 | [ ] |
| M8-T05 | Monte Carlo, CRN, intervalos de confianza, comparación pareada | 6 | [ ] |
| M8-T06 | Web Worker (progreso, cancelación, respaldo) y hook `useSimulacion` | 4 | [ ] |
| M8-T07 | Calibración desde histórico + backtest (API y lógica) | 7 | [ ] |
| M8-T08 | UI: parámetros, resultados, comparación (stepper c), gráficos y tornado | 6 | [ ] |
| M8-T09 | Escenarios guardados, exportación CSV/PDF, modelo de costos | 3 | [ ] |
| M8-T10 | Validación DES vs Erlang, E2E y documentación | 3 | [ ] |
| **Total** | | **52** | |
