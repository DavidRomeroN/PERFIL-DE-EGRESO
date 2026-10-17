# TurnoYa — Plan de migración del backend a Java Spring Boot

> Complementa [`ARQUITECTURA.md`](ARQUITECTURA.md) (estado actual del código).
> Aquí: **cómo pasar el backend de Next.js/Node a Spring Boot por fases**, sin congelar el producto y con vuelta atrás en cada paso.

## 1. Estrategia

Se migra por partes, sin congelar el producto. El backend en Node sigue funcionando mientras Spring Boot toma rutas, jobs y módulos de a poco. Cada fase tiene un **criterio de salida** y una **forma de volver atrás**.

Ambos backends comparten **la misma base PostgreSQL** durante la convivencia, así que volver atrás es cambiar el ruteo o un interruptor, sin migrar datos de vuelta.

### Hechos del código que condicionan el plan

| Hecho | Dónde |
|---|---|
| Bus de eventos en memoria (`EventEmitter`) | `backend/src/realtime.ts` |
| 17 jobs corriendo dentro del proceso web, reclamados con `UPDATE … RETURNING` sobre `job_estado` | `backend/src/jobs/scheduler.ts`, `backend/src/jobs/registro.ts`, `frontend/src/instrumentation.ts` |
| Teléfonos cifrados con AES-256-GCM en formato `iv.tag.cifrado` (base64) y hash SHA-256 del número normalizado | `backend/src/crypto.ts` |
| Secreto del PIN de citas derivado de `DATA_ENCRYPTION_KEY` + local | `backend/src/citas/service.ts` (`secretoPin`, `pinPresencia`, `validarPin`) |
| `kiosco/reglas.ts` se usa en el navegador **y** en el servidor | `frontend/src/app/kiosco/page.tsx`, `backend/src/kiosco/service.ts` |
| `capacidad/des.ts` y `erlang.ts` se usan en el navegador (Web Worker) **y** en el servidor | `frontend/src/app/admin/simulador/page.tsx`, `backend/src/capacidad/service.ts` |
| 8 páginas de Next.js leen la BD directamente con Prisma | `admin/layout.tsx`, `admin/configuracion/page.tsx`, `admin/modulos/citas/page.tsx`, `admin/modulos/prediccion/page.tsx`, `l/[slug]/page.tsx`, `page.tsx`, `panel/page.tsx`, `registro/page.tsx` |
| 129 endpoints en `frontend/src/app/api` | `frontend/src/app/api/**/route.ts` |

### Riesgos principales y en qué fase se resuelven

| Riesgo | Se prepara en | Se resuelve en |
|---|---|---|
| R1. Tiempo real sin virtual threads (un hilo bloqueado por conexión SSE) | Fase 1 | Fase 2 |
| R2. Jobs duplicados entre réplicas (`@Scheduled` corre en cada instancia) | Fase 0 | Fase 2, y se cierra en la 5 |
| R3. Compatibilidad del cifrado y los hashes con los datos existentes | Fase 0 | Fase 1 |
| R4. Lógica que también vive en el frontend (kiosco y simulador) | Fase 0 | Fase 4 |

---

## 2. Fase 0 — Preparación y red de seguridad (2–3 semanas)

**Objetivo:** dejar documentado cómo se comporta hoy el sistema, para que Java se pueda comparar contra eso.

1. **Congelar el contrato de la API.** Documentar los 129 endpoints en OpenAPI, junto con los 14 tipos de `EventoRealtime` como esquema JSON.
2. **Pruebas de caracterización (pruebas de contrato).** Una batería HTTP independiente del lenguaje (Postman/Newman, Karate o REST Assured) que se ejecute contra el backend Node hoy y contra el de Java después, con los mismos resultados esperados.
3. **Vectores dorados (R3 y R4).** Un script en Node genera archivos JSON con entradas y salidas reales; Java tiene que reproducirlos exactamente. Deben cubrir:
   - `normalizarTelefono`, `hashTelefono`, `cifrar` y `descifrar` (incluida la derivación de la clave cuando no son 64 caracteres hexadecimales);
   - `secretoPin`, `pinPresencia` y `validarPin`, más los hashes de los tokens del kiosco;
   - hashes bcrypt `$2b$` y JWT HS256 firmados con un secreto de prueba;
   - del kiosco: `corregirTiempo`, `validarEvento`, `mejorOffset`, `codigoProvisional` y `uuidv7`;
   - de capacidad: `erlangC`, `nivelServicio`, `minimoServidores`, y `simularReplica` con semillas fijas;
   - `calcular_clave_orden` de M1 y las reglas de citas de M3.
4. **Inventario de jobs (R2).** Los 17 jobs de `registro.ts`, con su frecuencia, si son idempotentes y qué tablas tocan.
5. **Decisiones fijadas en ADR:** Java 25 LTS (o 21), Spring Boot 4, Gradle multi-módulo con **Spring Modulith**, jOOQ más JPA, Flyway, Valkey (Redis) y Testcontainers.

**Criterio de salida:** la batería de contrato pasa al 100 % contra Node y los vectores dorados están versionados en el repositorio.

---

## 3. Fase 1 — Esqueleto Spring Boot y compatibilidad de datos (3–4 semanas)

**Objetivo:** que Java pueda leer y escribir los datos existentes sin romper nada.

1. **Proyecto base.** Spring Modulith con un módulo por dominio: `nucleo`, `prioridades`, `prediccion`, `citas`, `bot`, `kiosco`, `balanceo`, `analitica`, `capacidad`, `pagos` y `plataforma`. Spring Modulith hace cumplir las fronteras entre módulos en la compilación, que es el equivalente a la separación `reglas.ts`/`service.ts` de hoy.
2. **Virtual threads desde el primer día (R1).** Activar `spring.threads.virtual.enabled=true` y ajustar el pool de HikariCP. Los virtual threads no aumentan las conexiones a la BD.
3. **Migraciones con Flyway.** Tomar el esquema actual como línea base (`baselineVersion` igual a la última migración de Prisma). Desde aquí **Flyway es el único dueño del esquema**. Mientras convivan los dos backends, solo se permiten cambios **aditivos** (expandir y luego contraer), y Prisma se regenera con `prisma db pull`.
4. **Módulo de cifrado (R3).**
   - Separar `iv.tag.cifrado`, concatenar `cifrado + tag` y descifrar con `GCMParameterSpec(128, iv)`. Java espera el tag pegado al final del cifrado; si no se hace esto, **ningún teléfono guardado se podrá leer**.
   - Replicar la derivación de la clave (SHA-256 del texto si no son 64 caracteres hexadecimales).
   - Portar `normalizarTelefono` carácter por carácter. Una diferencia rompe la regla RN03 ("un celular, un turno activo") y el índice único `ux_cliente_telefono_hash`.
   - `BCryptPasswordEncoder` acepta los hashes `$2b$` de bcryptjs: no hace falta resetear contraseñas.
5. **Sesión compartida.** Spring Security acepta la misma cookie `turnoya_session` (HS256, mismo `JWT_SECRET`). Un usuario puede pasar de una ruta servida por Node a otra servida por Java sin volver a iniciar sesión.
6. **Pruebas cruzadas en CI, en los dos sentidos:** Node cifra y Java descifra, Java cifra y Node descifra. Lo mismo para los hashes, el PIN, bcrypt y JWT.

**Criterio de salida:** el 100 % de los vectores dorados de cifrado, hash, PIN y JWT pasa en Java, y Java descifra el 100 % de los teléfonos de una copia de producción.

**Vuelta atrás:** no hay nada que revertir; Java todavía no atiende tráfico.

---

## 4. Fase 2 — Infraestructura distribuida (3–4 semanas)

**Objetivo:** resolver el tiempo real y los jobs **antes** de mover lógica de negocio.

### 4.1 Tiempo real (R1)

1. **Bus en Redis compartido.** Cambiar el interior de `publicar()` en `realtime.ts` (Node) para que publique en un canal de Redis. Java publica en el mismo canal. Así, los dos backends alimentan un solo bus durante la convivencia.
2. **Gateway SSE en Java.**
   - `SseEmitter` sobre virtual threads, un suscriptor Redis por instancia y reparto local por `localId`.
   - Ping cada 20 s y soporte de `Last-Event-ID` para reconexiones.
   - El mismo filtro público/staff de hoy: al público no se le envía el texto de las notificaciones.
3. **Prueba de carga con k6 o Gatling:** por ejemplo, 10.000 conexiones SSE abiertas y 50 eventos por segundo. Medir la latencia del evento hasta la pantalla (p95), la memoria por conexión y el comportamiento al reiniciar una réplica.
4. Cuando la prueba pase, `/api/v1/realtime/:slug` pasa a Java. Node sigue publicando eventos, pero ya no atiende conexiones.

### 4.2 Jobs (R2)

5. **Mismo mecanismo de reclamo durante la convivencia.** Java reclama los jobs con **la misma tabla `job_estado`** y el mismo `UPDATE … WHERE proxima <= now() RETURNING`. Aunque un job quede activo por error en los dos backends, solo uno gana cada corrida.
   > ⚠ No usar ShedLock desde el inicio: usaría otra tabla de candados, y Node y Java ejecutarían el mismo job a la vez.
6. **Un interruptor por job.** Variable `JOBS_DESHABILITADOS` en Node y `JOBS_HABILITADOS` en Java. Los jobs se mueven de a uno.
7. **Reparto por tenant.** En Java, el job "padre" solo encola un trabajo por local (JobRunr o Redis Streams), y varios workers los procesan en paralelo.
8. **Prueba con Testcontainers:** 3 réplicas de Java y 1 de Node en paralelo. Cada corrida se ejecuta exactamente una vez y no se duplica ningún aviso ni recordatorio.

**Criterio de salida:** la prueba de carga SSE cumple la meta y la prueba de "exactamente una vez" pasa con varias réplicas.

**Vuelta atrás:** volver a apuntar `/realtime` a Node y apagar el interruptor de cada job en Java.

---

## 5. Fase 3 — Núcleo: turnos, colas y ventanillas (5–7 semanas)

**Objetivo:** mover el corazón del sistema con riesgo controlado.

1. **Ruteo por rutas.** Los *rewrites* de Next.js mandan `/api/v1/turnos`, `/colas`, `/ventanillas` y `/public/turnos` a Java.
2. **Funciones SQL sin reescribir.** Java llama a `emitir_turno`, `siguiente_turno` (`FOR UPDATE SKIP LOCKED`) y `posicion_turno` con **jOOQ**. JPA se usa solo para el CRUD simple (el caché y el *flush* automático de Hibernate pueden leer datos viejos dentro de la transacción).
3. **Equivalentes de `conIdempotencia`, `conAuditoria` y `rateLimit`.** Interceptores y aspectos alrededor de `@Transactional`, que fijan `app.usuario_id`, `app.request_id` y `app.ip` con `set_config` en la misma conexión.
4. **Piloto por tenant.** Primero 1 o 2 locales piloto pasan a Java, decidido por local en el proxy de Next. Después el 10 %, y luego el 100 %.
5. **Tráfico en sombra para las lecturas (GET).** Se envía la misma petición a Node y a Java y se registran las diferencias, sin afectar al usuario.
6. **Páginas que leen la BD directamente.** Las 8 páginas de Next.js que usan Prisma pasan a llamar a la API, con un cliente TypeScript generado por **orval** desde el OpenAPI de Spring (`springdoc-openapi`).
7. Portar las pruebas de integración de `backend/tests/integracion/nucleo.test.ts`, incluidas las 3 ventanillas concurrentes.

**Criterio de salida:**

- la batería de contrato pasa contra Java;
- dos ventanillas nunca llaman el mismo turno, también bajo carga;
- la regla RN03 sigue funcionando con los clientes existentes, porque el hash es idéntico;
- dos semanas en el 100 % sin incidentes.

**Vuelta atrás:** cambiar el ruteo del local a Node. Es inmediato, porque los dos backends comparten la misma BD.

---

## 6. Fase 4 — Módulos, de menor a mayor riesgo (8–12 semanas)

| Orden | Módulo | Puntos de cuidado |
|---|---|---|
| 1 | **M1 Prioridades** | Pruebas de propiedades con jqwik (P1–P4) |
| 2 | **M3 Citas** | `java.time` con `America/Lima`, ical4j, el `UPDATE` que evita sobrecupo y el PIN (validado en la Fase 1) |
| 3 | **M6 Balanceo** | Candados consultivos con `pg_try_advisory_xact_lock` |
| 4 | **M7 Analítica y reportes** | JasperReports u OpenPDF, archivos a S3/R2 en vez de `REPORTES_DIR`, refresco de `mv_turno_franja` |
| 5 | **M2 Predicción** | Portar los modelos y comparar las predicciones contra Node con un replay del histórico (tolerancia de ±1 %) |
| 6 | **Pagos** | Cambiar la URL del webhook en Mercado Pago. `clave_idem` es única: una notificación repetida no se aplica dos veces |
| 7 | **M4 Chatbot** | Cambiar la URL del webhook de Meta u OpenWA. La tabla compartida `evento_bot_procesado` evita procesar dos veces el mismo mensaje durante el cambio |
| 8 | **M5 Kiosco** | R4, ver §6.1 |
| 9 | **M8 Simulador** | R4, ver §6.2 |

### 6.1 M5 Kiosco (R4)

- **El servidor manda.** Java pasa a ser la autoridad en `validarEvento` y `corregirTiempo`, que deciden si un ticket offline se acepta o va a revisión.
- **Se quedan solo en TypeScript** las funciones que el dispositivo necesita sin conexión: `uuidv7`, `backoffMs`, `siguienteConexion`, `mejorOffset` y el almacenamiento en IndexedDB (`kiosco/almacen.ts`).
- **Viven en los dos lados:** `codigoProvisional` y `muestraReloj`. Los mismos vectores dorados corren en el CI de Node y en el de Java: si alguien cambia una sin cambiar la otra, el CI falla.
- **El contrato de `/kiosco/sync` no cambia.** Un kiosco puede llevar hasta `KIOSCO_VENTANA_OFFLINE_H` (12 h) sin conexión con eventos del formato anterior, así que Java debe aceptar ese formato durante por lo menos esa ventana después del cambio. Más adelante conviene versionar el endpoint (`/v2`).

### 6.2 M8 Simulador (R4)

**Decisión recomendada:** una sola fuente de verdad para el motor DES, en Java.

- La simulación de Monte Carlo y el análisis de sensibilidad (tornado) pasan a ser un trabajo asíncrono en el worker de Java. El navegador lo lanza por la API y recibe el avance por SSE.
- `erlang.ts` puede quedar duplicado en el frontend para la vista previa instantánea: son fórmulas cerradas y baratas, y los vectores dorados vigilan que coincidan.
- **Reproducibilidad.** `mulberry32` se porta usando `int` y `>>>` en Java, que tienen el mismo comportamiento de 32 bits que `Math.imul` en JS. Para `log` y `exp` usar `StrictMath`, no `Math`, para acercarse a lo que calcula V8. Se aceptan diferencias en los últimos decimales, con una tolerancia definida.
- Subir `VERSION_MOTOR` a `"des-2.0-java"`, para que cada escenario guardado registre con qué motor se calculó.

**Criterio de salida por módulo:** batería de contrato verde, vectores dorados verdes, el job del módulo movido con su interruptor y una semana en producción sin incidentes.

---

## 7. Fase 5 — Corte final y base del SaaS (6–8 semanas)

1. **Apagar Node.** Borrar `frontend/src/app/api`, sacar Prisma de Next.js y dejar Next.js solo como frontend.
2. **Reemplazar el planificador.** Con Node retirado, el reclamo sobre `job_estado` se reemplaza por **ShedLock o JobRunr** de forma definitiva (R2 cerrado).
3. **Cambios del SaaS, hechos una sola vez y ya en Java:**
   - la entidad `Organización` y las membresías de usuarios;
   - `tenant_id` en las 22 tablas que no lo tienen, más RLS, con `@TenantId` de Hibernate;
   - la tabla `Cliente` separada por tenant (Ley 29733);
   - Keycloak con organizaciones;
   - suscripciones recurrentes de Mercado Pago y funcionalidades contratadas por plan.
4. **Observabilidad:** Micrometer, Prometheus, Grafana y OpenTelemetry.

Estos cambios se dejan para el final a propósito: hacerlos durante la convivencia obligaría a implementarlos dos veces, en Node y en Java.

---

## 8. Equivalencias del stack

| Hoy (Node) | Spring Boot |
|---|---|
| Next.js route handlers | Spring Boot 4 con Java 25 LTS (o 21 LTS) |
| Prisma (migraciones) | Flyway (reutiliza los `.sql` actuales) |
| Prisma (consultas) | jOOQ para SQL complejo, Spring Data JPA para CRUD simple |
| zod | Bean Validation (`jakarta.validation`) |
| `conRol` / `enLocal` | Filtros de Spring Security con un `TenantContext` |
| `conIdempotencia` / `conAuditoria` | `HandlerInterceptor` y aspectos (AOP) alrededor de `@Transactional` |
| Planificador propio | Reclamo sobre `job_estado` (convivencia) → ShedLock o JobRunr |
| `EventEmitter` + SSE | `SseEmitter` con virtual threads y Redis pub/sub |
| pdf-lib | JasperReports u OpenPDF, JFreeChart |
| nodemailer | Spring Mail o SDK de Amazon SES |
| Llamadas HTTP a Mercado Pago | SDK oficial `sdk-java` |
| node:test | JUnit 5, jqwik y Testcontainers |
| Métricas hechas a mano | Micrometer y Actuator |

---

## 9. Duración estimada

Para un equipo de 3 a 4 desarrolladores Java, unos **7 a 10 meses**:

| Fase | Duración |
|---|---|
| 0. Preparación | 2–3 semanas |
| 1. Esqueleto y compatibilidad | 3–4 semanas |
| 2. Infraestructura distribuida | 3–4 semanas |
| 3. Núcleo | 5–7 semanas |
| 4. Módulos | 8–12 semanas |
| 5. Corte final y SaaS | 6–8 semanas |

Es una estimación aproximada. Depende sobre todo de cuánto tiempo del equipo siga dedicado a nuevas funcionalidades en paralelo.

---

## 10. Reglas para todo el proyecto

- **Una sola base de datos compartida** mientras convivan los dos backends, y siempre con cambios de esquema aditivos.
- **Nunca un job habilitado en los dos backends** sin el reclamo compartido sobre `job_estado`.
- **Ningún cambio de comportamiento durante la migración:** primero igualar a Node, después mejorar.
- **Cada fase se puede revertir** cambiando el ruteo o un interruptor, sin migrar datos de vuelta.
