# M1 · Motor de prioridades con aging

**Responsable:** Integrante 1 · **Estimación:** 40 h · **Complejidad:** ●●●○○ · **Plan:** EMPRENDE (hasta 4 categorías) / PRO (ilimitadas)
**Depende de:** F0 (pruebas), F3 (banderas), F5 (nueva `emitir_turno` y `siguienteTurno`) · **Lo usan:** M3, M4, M5, M6
**Pantallas Figma previstas:** M1a Reglas de prioridad · M1b Operador con cola priorizada · M1c Cliente: tipo de atención

---

## 1. Resumen y objetivo

Hoy el orden de atención es FIFO (`orderBy emitidoAt asc` en `llamarSiguiente`) y la posición del cliente se calcula con
`count(emitidoAt < mío)`. Eso impide dar **atención preferente** (adulto mayor, gestante, persona con discapacidad, emergencia) y, si
se hiciera ingenuamente (los preferentes siempre primero), los turnos generales podrían **no atenderse nunca** (inanición).

M1 introduce una **clave de orden** por turno que combina el peso de su categoría con su antigüedad (*aging*), más un **tope de
adelantos** consecutivos, de modo que:

1. Los preferentes pasan delante, pero…
2. …un turno general que esperó lo suficiente alcanza a los preferentes recientes, y
3. …existe una garantía dura: nunca más de *N* preferentes seguidos mientras haya un general esperando.

## 2. Alcance

**Incluye:** categorías configurables por local; autodeclaración del cliente (web, kiosco, bot); verificación/rechazo por el operador;
clave de orden persistida e indexada; selección atómica del siguiente turno; posición y avisos coherentes con el nuevo orden; simulador
de vista previa; auditoría de cambios; ocultar la categoría en pantallas públicas.

**No incluye (v1):** α distinto por categoría (rompería la estabilidad del orden, ver §6.1), validación automática de documentos contra
RENIEC/CONADIS, prioridades por cola distinta (una configuración por local).

## 3. Actores e historias de usuario

| Actor | Historia | Criterio resumido |
|---|---|---|
| Admin del local | Como admin quiero definir categorías, pesos y el parámetro de antigüedad para adaptar la prioridad a mi servicio | CRUD de categorías, α y tope; vista previa antes de guardar |
| Cliente | Como adulto mayor quiero indicar mi condición al sacar turno para ser atendido con prioridad | Selector en `/l/[slug]`; el sistema avisa que se verificará el documento |
| Operador | Como operador quiero ver por qué el siguiente turno es el siguiente y poder rechazar una prioridad indebida | Explicación del puntaje; botones Verificar / No corresponde |
| Cliente general | Como cliente general quiero la garantía de que no esperaré indefinidamente | Tope de adelantos + aging |
| Super admin | Quiero activar M1 solo para planes EMPRENDE/PRO | Bandera de módulo |

## 4. Requisitos

**Funcionales**
- **RF-M1-01** El admin crea/edita/desactiva categorías con: código, nombre, peso base (0–1000), documento requerido, espera máxima objetivo, visible para el cliente, absoluta (salta la cola).
- **RF-M1-02** Existe siempre la categoría `GENERAL` (peso 0), no eliminable.
- **RF-M1-03** El admin configura α (puntos por minuto de espera, 0–10) y el tope de adelantos (0–10; 0 = sin tope) y activa/desactiva el *aging*.
- **RF-M1-04** El cliente puede autodeclarar una categoría `visible_cliente` al emitir el turno (web, kiosco, bot).
- **RF-M1-05** `llamarSiguiente` elige el turno de mayor clave de orden respetando el tope de adelantos.
- **RF-M1-06** El operador ve la cola ordenada, la categoría de cada turno y la explicación del puntaje del siguiente.
- **RF-M1-07** El operador puede **verificar**, **rechazar** (pasa a GENERAL conservando antigüedad) o **cambiar** la categoría de un turno en espera.
- **RF-M1-08** La posición y el tiempo estimado del cliente reflejan el nuevo orden.
- **RF-M1-09** Vista previa: el admin ve el orden FIFO vs priorizado de una cola simulada antes de guardar.

**Reglas de negocio**
- **RN-M1-01** `clave_orden = peso_efectivo − α × minutos_desde_origen(emitido_at)`; mayor clave ⇒ primero. Desempate: `emitido_at`, luego `id`.
- **RN-M1-02** Una categoría `absoluta` tiene `peso_efectivo = 1 000 000`; no cuenta para el tope de adelantos.
- **RN-M1-03** Tope de adelantos: si el contador de preferentes consecutivos de la cola ≥ tope y hay algún turno de peso 0 en espera, se llama al mejor turno de peso 0 y el contador vuelve a 0.
- **RN-M1-04** Rechazar una prioridad **no** cambia `emitido_at`; solo recalcula la clave con peso 0.
- **RN-M1-05** Al cambiar α o los pesos, se recalcula la clave de los turnos **en espera del día**.
- **RN-M1-06** La categoría nunca se muestra en la TV, en el ticket impreso ni en mensajes de WhatsApp (dato sensible).
- **RN-M1-07** Máx. 4 categorías activas en EMPRENDE.

**No funcionales**
- **RNF-M1-01** `siguienteTurno` p95 < 20 ms con 5 000 turnos en espera (índice parcial).
- **RNF-M1-02** Sin duplicados al llamar desde dos ventanillas simultáneamente (0 en 200 corridas).
- **RNF-M1-03** Cambio de configuración aplicado a todos los turnos en espera en < 2 s para 5 000 filas.

## 5. Diseño de datos

### 5.1 Prisma

```prisma
enum DocumentoPrioridad {
  NINGUNO
  DNI
  CARNE_GESTANTE
  CONADIS
  TRIAJE
}

model CategoriaPrioridad {
  id             Int                @id @default(autoincrement())
  localId        Int                @map("local_id")
  codigo         String             @db.VarChar(16)   // GENERAL | ADULTO_MAYOR | GESTANTE | DISCAPACIDAD | EMERGENCIA | CITA | ...
  nombre         String
  icono          String?
  pesoBase       Int                @map("peso_base") // 0..1000
  absoluta       Boolean            @default(false)
  documento      DocumentoPrioridad @default(NINGUNO)
  esperaMaxSeg   Int?               @map("espera_max_seg")
  visibleCliente Boolean            @default(true) @map("visible_cliente")
  activa         Boolean            @default(true)
  orden          Int                @default(0)

  local  Local   @relation(fields: [localId], references: [id], onDelete: Cascade)
  turnos Turno[]

  @@unique([localId, codigo])
  @@map("categoria_prioridad")
}

model ConfigPrioridad {
  localId          Int      @id @map("local_id")
  alfaPuntosPorMin Decimal  @default(1.5) @map("alfa_puntos_por_min") @db.Decimal(6, 3)
  topeAdelantos    Int      @default(3) @map("tope_adelantos")
  agingActivo      Boolean  @default(true) @map("aging_activo")
  actualizadoAt    DateTime @updatedAt @map("actualizado_at")

  local Local @relation(fields: [localId], references: [id], onDelete: Cascade)
  @@map("config_prioridad")
}

model EstadoPrioridadCola {
  colaId                   Int      @map("cola_id")
  fecha                    DateTime @db.Date
  preferentesConsecutivos  Int      @default(0) @map("preferentes_consecutivos")

  @@id([colaId, fecha])
  @@map("estado_prioridad_cola")
}

// En Turno (migración aditiva):
//   categoriaId           Int?     @map("categoria_id")
//   claveOrden            Float    @default(0) @map("clave_orden")        // double precision
//   prioridadVerificada   Boolean? @map("prioridad_verificada")           // null: no aplica · true · false (rechazada)
```

### 5.2 SQL (migración `…_m1_prioridades`)

```sql
-- Origen fijo para mantener la clave en un rango numérico cómodo (doble precisión).
CREATE OR REPLACE FUNCTION calcular_clave_orden(
  p_peso numeric, p_emitido timestamptz, p_alfa numeric, p_aging boolean
) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_peso - CASE WHEN p_aging
            THEN p_alfa * EXTRACT(EPOCH FROM (p_emitido - TIMESTAMPTZ '2026-01-01 00:00:00+00')) / 60.0
            ELSE 0 END)::double precision
$$;

-- Índice parcial que sirve tanto a siguienteTurno() como a posicion_turno().
CREATE INDEX IF NOT EXISTS ix_turno_espera
  ON turno (cola_id, clave_orden DESC, emitido_at ASC, id ASC)
  WHERE estado IN ('EMITIDO', 'AVISADO');

-- Posición exacta (sin considerar el tope de adelantos) = 1 + turnos que van antes.
CREATE OR REPLACE FUNCTION posicion_turno(p_turno int) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT 1 + COUNT(*)::int
    FROM turno t
    JOIN turno o ON o.cola_id = t.cola_id AND o.fecha = t.fecha
   WHERE t.id = p_turno
     AND o.estado IN ('EMITIDO', 'AVISADO')
     AND (o.clave_orden > t.clave_orden
          OR (o.clave_orden = t.clave_orden AND (o.emitido_at < t.emitido_at
              OR (o.emitido_at = t.emitido_at AND o.id < t.id))))
$$;
```

`emitir_turno()` (F5) calcula la clave al insertar:

```sql
-- dentro de emitir_turno(), tras obtener v_num:
SELECT COALESCE(CASE WHEN c.absoluta THEN 1000000 ELSE c.peso_base END, 0)
  INTO v_peso FROM categoria_prioridad c WHERE c.id = p_categoria AND c.activa;
SELECT alfa_puntos_por_min, aging_activo INTO v_alfa, v_aging
  FROM config_prioridad WHERE local_id = v_local;   -- si no hay fila: alfa 0 / aging false
INSERT INTO turno (..., categoria_id, clave_orden, emitido_at)
VALUES (..., p_categoria,
        calcular_clave_orden(COALESCE(v_peso,0), p_emitido, COALESCE(v_alfa,0), COALESCE(v_aging,false)),
        p_emitido);
```

### 5.3 Datos iniciales (seed por local)

| código | nombre | peso | absoluta | documento | visible cliente | espera máx |
|---|---|---|---|---|---|---|
| GENERAL | General | 0 | no | NINGUNO | sí | — |
| ADULTO_MAYOR | Adulto mayor (60+) | 60 | no | DNI | sí | 30 min |
| GESTANTE | Gestante | 60 | no | CARNE_GESTANTE | sí | 30 min |
| DISCAPACIDAD | Persona con discapacidad | 50 | no | CONADIS | sí | 30 min |
| EMERGENCIA | Emergencia | 100 | **sí** | TRIAJE | **no** (solo operador) | 0 |

`config_prioridad`: α = 1.5, tope = 3, aging = true.

## 6. Algoritmo

### 6.1 Propiedad clave: el orden es **estable en el tiempo**

Puntaje mostrado: `P(t) = peso + α·(ahora − emitido)/60`. Para dos turnos A y B:

```
P_A − P_B = (peso_A − peso_B) + α·(emitido_B − emitido_A)/60        ← no depende de "ahora"
```

Por tanto el orden relativo **no cambia con el paso del tiempo**: basta persistir `clave = peso − α·emitido/60` (el término `α·ahora/60`
es común y se cancela). Beneficios: se indexa, la posición de cada cliente es estable y no hace falta un job que "re-puntúe" cada minuto.
Consecuencia de diseño: **α distinto por categoría rompería esta propiedad** (el orden dependería del tiempo) ⇒ queda fuera de v1.

**Interpretación práctica de α:** un turno general con `Δ` minutos más de antigüedad iguala a un preferente de peso `w` cuando `Δ = w/α`.
Con α = 1.5 y w = 60 ⇒ Δ = 40 min: un general que lleva 40 min más esperando que un adulto mayor recién llegado pasa delante.

### 6.2 Selección del siguiente turno (pseudocódigo)

```
function siguienteTurno(tx, localId, colaId, ventanillaId):
    cfg    = leerConfigPrioridad(localId)            // alfa, tope, aging
    estado = upsert estado_prioridad_cola(colaId, hoy) FOR UPDATE   // serializa la decisión por cola

    cand = SELECT … ORDER BY clave_orden DESC, emitido_at, id
           FOR UPDATE SKIP LOCKED LIMIT 1            // sobre turnos EMITIDO/AVISADO de la(s) cola(s) de la ventanilla

    if cand == null: return null

    esPreferente = cand.categoria.pesoBase > 0 and not cand.categoria.absoluta
    if cfg.tope > 0 and esPreferente and estado.preferentesConsecutivos >= cfg.tope:
        general = SELECT … WHERE categoria.pesoBase = 0 ORDER BY clave_orden DESC … FOR UPDATE SKIP LOCKED LIMIT 1
        if general != null: cand = general         // se rompe la racha

    if cand.categoria.absoluta:       // no altera la racha
        pass
    elif cand.categoria.pesoBase > 0: estado.preferentesConsecutivos += 1
    else:                             estado.preferentesConsecutivos = 0

    return cand
```

Todo ocurre en **una transacción** junto con el `UPDATE turno SET estado='LLAMADO'`. `SKIP LOCKED` evita que dos ventanillas tomen el mismo turno.
Si el candidato óptimo está bloqueado por otra ventanilla, se toma el siguiente (comportamiento deseado en una cola concurrente).

### 6.3 Explicación del puntaje (UI del operador)

```
explicar(turno, ahora, cfg) → { base: peso, antiguedad: α × minEspera, total: base + antiguedad }
```
Ejemplo de Figma: `82 pts = 50 (base, Discapacidad) + 1.5 × 21 min (≈ 32)`.

### 6.4 Posición mostrada al cliente
`posicion = posicion_turno(id)`; `personasDelante = posicion − 1`. Cuando el tope pueda alterar el orden real, la UI muestra "≈". El tiempo estimado se
calcula con esa posición (M2 sustituye el cálculo).

### 6.5 Recalculo por cambio de configuración
```sql
UPDATE turno t
   SET clave_orden = calcular_clave_orden(
         COALESCE(CASE WHEN c.absoluta THEN 1000000 ELSE c.peso_base END, 0),
         t.emitido_at, $alfa, $aging)
  FROM (SELECT t2.id, c2.* FROM turno t2 LEFT JOIN categoria_prioridad c2 ON c2.id = t2.categoria_id) c
 WHERE t.id = c.id AND t.local_id = $local AND t.fecha = $hoy AND t.estado IN ('EMITIDO','AVISADO');
```
Se hace en una transacción con `conAuditoria` y publica `prioridad:config`.

## 7. API

Todas bajo `/api/v1`, con `exigirModulo(localId, "M1")`.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/prioridades` | ADMIN+ | `{ config, categorias[] }` |
| PUT | `/prioridades/config` | ADMIN+ | Actualiza α, tope, aging; recalcula claves |
| POST | `/prioridades/categorias` | ADMIN+ | Crea categoría |
| PATCH | `/prioridades/categorias/:id` | ADMIN+ | Edita (no permite desactivar GENERAL) |
| DELETE | `/prioridades/categorias/:id` | ADMIN+ | Desactiva (borrado lógico si tiene turnos) |
| POST | `/prioridades/simular` | ADMIN+ | Entrada: turnos hipotéticos + config; salida: orden FIFO vs priorizado |
| GET | `/public/locales/:slug` | público | Ahora incluye `categorias[]` con `visibleCliente` (solo código, nombre, icono, documento) |
| POST | `/public/turnos` | público | Acepta `categoriaId` (solo si `visibleCliente`) |
| PATCH | `/turnos/:id/prioridad` | OPERADOR+ | `{ accion: "VERIFICAR" \| "RECHAZAR" \| "CAMBIAR", categoriaId? }` |
| GET | `/panel/estado` | OPERADOR+ | Cola ordenada por clave + `explicacion` del siguiente |

**Ejemplo `PUT /prioridades/config`**
```json
{ "alfaPuntosPorMin": 1.5, "topeAdelantos": 3, "agingActivo": true }
```
→ `{ "ok": true, "data": { "recalculados": 38 } }`

**Ejemplo `POST /prioridades/simular`**
```json
{ "config": { "alfaPuntosPorMin": 1.5, "topeAdelantos": 3, "agingActivo": true },
  "turnos": [
    { "codigo": "A-030", "categoria": "GENERAL", "esperaMin": 38 },
    { "codigo": "A-031", "categoria": "DISCAPACIDAD", "esperaMin": 21 },
    { "codigo": "A-033", "categoria": "GESTANTE", "esperaMin": 9 } ] }
```
→ `{ "fifo": ["A-030","A-031","A-033"], "priorizado": ["A-031","A-033","A-030"], "puntajes": {"A-031":82,"A-033":74,"A-030":57} }`

**Errores:** `M1_CATEGORIA_INVALIDA` (404), `M1_CATEGORIA_NO_DISPONIBLE` (409, no visible para el cliente), `M1_PESO_FUERA_DE_RANGO` (422), `M1_NO_ELIMINAR_GENERAL` (409), `M1_LIMITE_CATEGORIAS` (402), `MODULO_NO_DISPONIBLE` (403).

## 8. Eventos y jobs
- Evento `prioridad:config` (tras recalcular) y `cola:actualizada` (existente) tras cada cambio de categoría de un turno.
- Sin jobs propios (el orden es estable); opcional: job nocturno `prioridad-verificar-consistencia` que compara `clave_orden` con el recalculado y reporta divergencias.

## 9. UI

| Ruta | Contenido | Estados a cubrir |
|---|---|---|
| `/admin/modulos/prioridades` (pestaña **Reglas**) | Tabla editable de categorías, controles de α y tope, interruptores, **vista previa** FIFO vs priorizado | cargando · vacío (solo GENERAL) · error · guardado (toast) |
| Pestaña **Vista del operador** | Réplica de solo lectura del panel con datos simulados | — |
| `/panel` (modificado) | Cola ordenada con badge de categoría, puntaje, explicación del siguiente, botones **Verificar** / **No corresponde** | sin turnos · turno rechazado (confirmación) |
| `/l/[slug]` (modificado) | Paso "Tipo de atención" (radio) solo si M1 activo y hay categorías visibles | categoría con documento ⇒ aviso |
| `/ticket/[token]`, TV, WhatsApp | **No** muestran categoría (RN-M1-06) | — |

Componentes nuevos: `SelectorCategoria`, `BadgeCategoria`, `ExplicacionPuntaje`, `SliderConValor`, `VistaPreviaCola`.
Accesibilidad: el selector debe operarse con teclado; íconos con texto alternativo; objetivos táctiles ≥ 44 px.

## 10. Integración con el núcleo (archivos a tocar)
| Archivo | Cambio |
|---|---|
| `backend/prisma/schema.prisma` + migración | Modelos y columnas de §5 |
| `backend/src/turnos.ts` · `emitirTurno` | Recibe `categoriaId`, valida `visibleCliente` y módulo activo, pasa `p_categoria` a `emitir_turno` |
| `backend/src/turnos.ts` · `llamarSiguiente` | Sustituye `findFirst … orderBy emitidoAt` por `siguienteTurno(tx, …)` (F5) |
| `backend/src/turnos.ts` · `obtenerTurnoPorToken` | `posicion` con `posicion_turno()` |
| `backend/src/turnos.ts` · `revisarAvisos` | Ordenar la espera por `claveOrden desc, emitidoAt asc` |
| `backend/src/turnos.ts` · `snapshotLocal` | Ordenar `espera[]` por clave y **no** exponer categoría en el snapshot público |
| `frontend/src/app/api/v1/turnos/ticket/route.ts` | El operador puede emitir ticket con categoría |
| `backend/src/prioridades/{reglas,service,repo}.ts` | Lógica pura, casos de uso, SQL |

## 11. Seguridad y privacidad
- La categoría es **dato sensible**: solo la ven roles OPERADOR+ del mismo local; se omite en `snapshotLocal` público, TV, ticket y plantillas de WhatsApp.
- Un cliente no puede autodeclarar categorías con `visibleCliente = false` (EMERGENCIA).
- Cada cambio de categoría/rechazo queda en auditoría con actor (F4).
- Anti-abuso: contar rechazos por `telefono_hash` (30 días); a partir de 3, marcar el turno con aviso visual al operador (no bloquea al cliente).

## 12. Pruebas

**Unitarias (`reglas.ts`)**
1. `claveOrden`: mismo peso ⇒ orden FIFO; mayor peso ⇒ mayor clave; `absoluta` ⇒ siempre primero.
2. `explicarPuntaje` suma base + antigüedad y coincide con la diferencia de claves.
3. `seleccionarSiguiente` aplica el tope: con tope = 3 y 5 preferentes + 1 general, el orden de llamadas es P,P,P,G,P,P.
4. Con tope = 0 no hay racha forzada; con `aging = false` no hay cruce.
5. Redondeos: α con 3 decimales; límites 0 y 10.

**Propiedades (`fast-check`)**
- **P1 (no inanición por aging):** si `A.emitido ≤ B.emitido − (pesoB − pesoA)/α` entonces A sale antes que B.
- **P2 (tope):** en cualquier secuencia, nunca hay más de `tope` preferentes consecutivos mientras exista un general en espera.
- **P3 (estabilidad):** el orden de una lista no cambia al avanzar el reloj.
- **P4 (rechazo):** rechazar una prioridad nunca adelanta al turno respecto de los generales más recientes.

**Integración SQL**
- `emitir_turno` con categoría calcula la clave esperada.
- `posicion_turno` coincide con el índice en la lista ordenada para 500 turnos aleatorios.
- Recalculo masivo: 5 000 filas < 2 s.
- Plan de ejecución de `siguienteTurno` usa `ix_turno_espera` (`EXPLAIN`).

**Concurrencia**
- 3 ventanillas × 100 llamadas sobre 300 turnos: ningún turno llamado dos veces; el conjunto llamado = 300.
- Racha con 2 ventanillas simultáneas: el contador queda coherente (`SELECT … FOR UPDATE` sobre `estado_prioridad_cola`).

**API / permisos**
- OPERADOR no puede `PUT /prioridades/config` (403); local sin M1 ⇒ 403 `MODULO_NO_DISPONIBLE`; cliente no puede declarar EMERGENCIA; otro local no ve categorías.

**E2E (Playwright)**
- Escenario 4 del plan (gestante pasa delante; general antiguo no queda relegado) y rechazo de prioridad por el operador.

**Privacidad**
- Test que recorre `snapshotLocal` público, la TV y el ticket verificando que **no** aparece ningún campo de categoría.

## 13. Observabilidad
Métricas: `m1_llamadas_total{categoria}`, `m1_rachas_cortadas_total`, `m1_rechazos_total`, `m1_recalculo_ms`. Log por llamada: `{ modulo:"M1", turno, categoria, clave, rachaAntes, rachaDespues }`.
Panel en M7: espera media por categoría vs `espera_max_seg`.

## 14. Criterios de aceptación

```gherkin
Escenario: Gestante pasa delante de un general reciente
  Dado una cola con A-030 (General, 5 min de espera)
  Y una gestante que emite A-031 hace 1 minuto
  Cuando el operador pulsa "Llamar siguiente"
  Entonces se llama A-031

Escenario: Un general antiguo alcanza a los preferentes
  Dado α = 1.5 y peso Gestante = 60
  Y A-030 (General) lleva 45 minutos esperando
  Y A-031 (Gestante) llegó hace 1 minuto
  Cuando el operador pulsa "Llamar siguiente"
  Entonces se llama A-030

Escenario: Tope de adelantos
  Dado tope = 3 y 4 preferentes recientes y 1 general reciente
  Cuando se llaman 4 turnos seguidos
  Entonces el cuarto llamado es el general

Escenario: Rechazo de prioridad
  Dado un turno con categoría Adulto mayor sin documento
  Cuando el operador pulsa "No corresponde"
  Entonces el turno pasa a General conservando su hora de emisión
  Y queda un registro de auditoría con el operador

Escenario: Privacidad
  Cuando se abre la pantalla TV y el ticket impreso de un turno prioritario
  Entonces no aparece la categoría en ninguno
```

## 15. Riesgos
| Riesgo | Mitigación |
|---|---|
| Declaraciones falsas masivas | Verificación en ventanilla, contador de rechazos, alerta en M7 |
| Cambiar α a mitad del día reordena la cola | Confirmación en UI con vista previa; aplicar solo a turnos en espera; registrar en auditoría |
| Precisión de `double precision` al restar épocas | Origen fijo 2026-01-01; prueba con 100 000 turnos |
| Operadores confundidos por el orden | Explicación del puntaje y capacitación breve (manual) |

## 16. Plan de tareas

| ID | Tarea | Horas | Estado |
|---|---|---|---|
| M1-T01 | Migración Prisma + SQL (`calcular_clave_orden`, `posicion_turno`, índice) y seed de categorías | 4 | [ ] |
| M1-T02 | `reglas.ts` (clave, orden, selección con tope, explicación, simulación) + unitarias + propiedades | 7 | [ ] |
| M1-T03 | `siguienteTurno` en SQL/Prisma dentro de `llamarSiguiente` + pruebas de concurrencia | 6 | [ ] |
| M1-T04 | `emitirTurno` con categoría; posición y avisos con el nuevo orden | 4 | [ ] |
| M1-T05 | API de configuración, categorías, simulador y verificación (zod, permisos, módulo) | 5 | [ ] |
| M1-T06 | UI admin (reglas, sliders, vista previa) | 6 | [ ] |
| M1-T07 | Cambios en `/panel` (cola ordenada, explicación, verificar/rechazar) y `/l/[slug]` (selector) | 5 | [ ] |
| M1-T08 | Privacidad: purgar categoría de snapshot/TV/ticket + prueba | 1 | [ ] |
| M1-T09 | E2E, métricas, documentación (manual del operador) | 2 | [ ] |
| **Total** | | **40** | |
