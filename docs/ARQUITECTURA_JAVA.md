# TurnoYa en Java — arquitectura y guía para migrar módulos

> Estado: **núcleo migrado** (colas, ventanillas, turnos, panel de ventanilla, pantalla TV, "mi turno", ticket,
> login, administración de colas y ventanillas). M1–M8, pagos, usuarios, configuración del local y super-admin
> siguen en el sistema anterior (commit `bce0774`, carpeta `legacy/`) hasta que se migren con la receta de la sección 6.
>
> Complementa [`MIGRACION_SPRING.md`](MIGRACION_SPRING.md) (plan por fases) y [`ARQUITECTURA.md`](ARQUITECTURA.md)
> (sistema anterior).

---

## 1. Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Estilo | **Monolito modular** con Spring Modulith 2.1 | Los turnos necesitan transacciones fuertes en una sola BD (`FOR UPDATE SKIP LOCKED`); los módulos dan fronteras claras sin sistemas distribuidos. |
| Dentro de cada módulo | **Hexagonal + vertical slicing**: `dominio` (modelo y puertos) · `infraestructura` (adaptadores) · una carpeta por funcionalidad | Las reglas no dependen de la BD ni de la web; los adaptadores (BD, WhatsApp, Redis) se cambian sin tocar el negocio; todo lo de una funcionalidad (caso de uso, API, vista) está junto. |
| Entre módulos | **Eventos** (`@ApplicationModuleListener`) y **puertos** | El núcleo no llama a notificaciones ni a la TV: publica lo que pasó. Nada de llamadas encadenadas ("código en cascada"). |
| Garantía de entrega | Registro de publicaciones de Modulith (tabla `event_publication`, migración V11) | Si el proceso se cae antes de enviar un WhatsApp, el evento se reintenta al arrancar. |
| Acceso a datos | **JdbcClient con SQL explícito** (sin JPA ni jOOQ) | El dominio ya vive en SQL (funciones de turnos, enums nativos, `TIMESTAMP` en UTC). SQL visible = fácil de revisar; sin magia de ORM. *Cambia lo previsto en MIGRACION_SPRING.md (jOOQ + JPA).* |
| Migraciones | **Flyway** con las 10 migraciones de Prisma copiadas sin cambios (V1–V10) | En una BD existente toma la versión 10 como base; en una vacía crea todo. |
| Frontend | **Thymeleaf + htmx** (hipermedia), JavaScript mínimo | Un solo lenguaje para el equipo. El navegador solo hace lo que no puede hacer el servidor: sonido, voz, vibración, imprimir. |
| CSS | Hojas propias con **tokens de diseño** (mismos colores que el sistema anterior) | Sin herramientas de Node ni compilación de CSS. |
| JS de terceros | htmx y su extensión SSE como **WebJars** (versión fija en `gradle/libs.versions.toml`) | Nada copiado al repositorio; se actualiza cambiando una línea. |
| Sesión | **JWT HS256 en la cookie `turnoya_session`**, mismo secreto y campos que el sistema anterior | Durante la convivencia, una sesión sirve en los dos sistemas. |
| Tiempo real | SSE con **hilos virtuales**; bus **en memoria** o **Redis** (`TURNOYA_BUS=redis`) | Resuelve el riesgo 1 del plan: varias réplicas comparten los eventos. |
| Tareas programadas | Reclamo en la tabla **`job_estado`** (misma regla que el sistema anterior) | Resuelve el riesgo 2: aunque corran el sistema anterior y Java a la vez, cada corrida se ejecuta una sola vez. |
| Datos personales | Cifrado AES-GCM y hash del celular **byte a byte compatibles** con el sistema anterior | Resuelve el riesgo 3: lo comprueban los vectores dorados (sección 7). |

### Correcciones de seguridad respecto del sistema anterior

- El estado público del local (`/api/v1/public/locales/:slug/estado`, pantalla TV) ya **no incluye los tokens de seguimiento** de cada turno. Con ellos cualquiera podía cancelar turnos ajenos.
- El canal SSE público tampoco envía el token en `turno:llamado` / `turno:estado`.
- Las páginas usan **CSRF** (cookie + cabecera que envía htmx) y una **CSP sin scripts en línea** (`script-src 'self'`).

---

## 2. Módulos

```
compartido      (abierto)  errores, tiempo, cifrado, web, límite de peticiones, tareas
   ▲
plataforma                 locales, planes, módulos contratados, horario, sesión, auditoría
   ▲
nucleo                     colas, ventanillas, turnos ──publica──▶ eventos
   ▲   ▲
   │   └── notificaciones  escucha TurnoAvisado / TurnoLlamado / TurnoVencido → WhatsApp o web
   └────── tiemporeal      escucha eventos del núcleo y de notificaciones → SSE
```

Regla: **las flechas solo apuntan hacia arriba**. `ModularidadTest` falla si aparece un ciclo o si un módulo usa una
clase interna de otro. Los diagramas actualizados quedan en `backend/build/spring-modulith-docs` después de `gradlew test`.

### API de cada módulo

| Módulo | Lo que otros pueden usar |
|---|---|
| `compartido` | Todo (módulo abierto) |
| `plataforma` | `CatalogoLocales`, `ModulosLocal`, `HorarioAtencion`, `Auditoria`, `LocalDeTrabajo`, `Local`, `Plan`, `Sesion`, `Modulo`, `RolUsuario`, `@SoloPersonal`, `@SoloAdmin` |
| `nucleo` | `ConsultaTurnos`, `ContactoTurnos`, `TomaDeTurnos` (puerto de entrada de los canales conversacionales), `TurnoPublico`, `SnapshotLocal`, `EstadoTurno`, `CanalTurno`; `nucleo.eventos.*`; `nucleo.puertos.*` |
| `notificaciones` | `NotificacionRegistrada` (evento), `MensajesWhatsApp` (respuestas de texto libre del bot) |
| `tiemporeal` | — (solo escucha) |

### Puertos del núcleo (para M1, M2 y M3)

| Puerto | Lo implementa | Si nadie lo implementa |
|---|---|---|
| `PoliticaPrioridad` | M1 Prioridades | Turno general, orden FIFO |
| `EstimadorEspera` | M2 Predicción | Función SQL `tiempo_estimado` (RN02) |
| `OfertaCitas` | M3 Citas | No se ofrece reservar |
| `AvisosDelTurno` | notificaciones (ya implementado) | Lista vacía |

Cada implementación responde `aplica(localId)` (por ejemplo, "M2 está encendido en este local"); `ExtensionesNucleo`
elige la primera que aplica. **Ningún caso de uso pregunta si un módulo está activo**: esa decisión vive en un solo lugar.

### Eventos del núcleo

| Evento | Cuándo | Quién escucha hoy |
|---|---|---|
| `TurnoEmitido` | Se emitió un turno | (M2 registrará la predicción) |
| `TurnoLlamado` | Una ventanilla llamó o rellamó | notificaciones, tiemporeal |
| `TurnoCambioEstado` | Cualquier cambio de estado | tiemporeal |
| `TurnoAvisado` | Le faltan N personas | notificaciones |
| `TurnoVencido` | RN04: no se presentó a tiempo | notificaciones |
| `TurnoCerrado` | Atendido, no se presentó o cancelado | (M3 cerrará la cita; M2 aprenderá) |
| `ColaActualizada` | Cambió algo en las colas | tiemporeal |

Los eventos **no llevan datos personales**: quedan guardados en `event_publication`. Quien necesite el celular lo pide a
`ContactoTurnos` en el momento de usarlo.

---

## 3. Dentro de un módulo: hexagonal con vertical slicing

Cada módulo es un **hexágono**: en el centro el dominio con sus **puertos**; alrededor, los **adaptadores**. Los
adaptadores de salida (BD, WhatsApp, Redis) viven en `infraestructura/`. Los de entrada (API REST y vistas) viven
**dentro de la funcionalidad** a la que pertenecen, junto a su caso de uso: eso es el *vertical slicing*. Para cambiar
"llamar al siguiente" se abre una sola carpeta (`atencion/`), no cuatro capas.

```
pe.turnoya.<modulo>/
  (raíz)            API pública: servicios de consulta, registros que devuelven, enums
  eventos/          @NamedInterface: eventos que publica
  puertos/          @NamedInterface: interfaces que implementan otros módulos (M1, M2, M3…)
  dominio/          modelo y reglas puras + puertos de salida (Repositorio*): sin SQL ni web
  infraestructura/  adaptadores de salida: *Jdbc (implementan los Repositorio*), WhatsApp, Redis
  <funcionalidad>/  un slice por funcionalidad: caso(s) de uso + *Api (@RestController) + *Vista (@Controller)
```

El núcleo, por ejemplo:

| Slice | Qué hace | Clases |
|---|---|---|
| `emision/` | Tomar turno por QR (RF01) y ticket impreso (RF07) | `EmisionTurnos`, `InformacionLocal`, `EmisionApi`, `TomarTurnoVista`, `TicketVista` |
| `seguimiento/` | "Mi turno": consultar, cancelar (RF04) y valorar (N07) | `CancelacionTurnos`, `Valoraciones`, `SeguimientoApi`, `MiTurnoVista` |
| `atencion/` | Panel de ventanilla: llamar, atender, rellamar (RF05, RF06) | `OperacionVentanilla`, `AtencionApi`, `PanelVista` |
| `historial/` | Historial del día con indicadores (N02) | `HistorialTurnos`, `HistorialApi` |
| `pantalla/` | Pantalla TV (RF12) | `PantallaApi`, `PantallaTvVista` |
| `colas/`, `ventanillas/` | Administración (RF08) | `GestionColas`, `ColasApi`, `AdminColasVista`… |
| `avisos/` | Aviso cuando faltan N personas (RF03) | `AvisosCola` |
| `expiracion/` | RN04: llamado sin presentarse | `ExpiracionLlamados`, `TareaExpiracion` |
| `extensiones/` | Elige la implementación de cada puerto por local | `ExtensionesNucleo`, `EsperaPorPromedio` |

`ArquitecturaHexagonalTest` (ArchUnit) hace cumplir las reglas: el dominio no conoce la BD ni la web ni las
funcionalidades; nadie fuera de `infraestructura/` usa un adaptador (los `*Jdbc` ni siquiera son públicos); el SQL solo
vive en los adaptadores; los controladores no están en `dominio/` ni en `infraestructura/`.

Reglas prácticas:

- Un **caso de uso por clase** con nombre de negocio, en el slice de su funcionalidad. Si un método crece, se divide;
  si dos slices se llaman entre sí en cadena, probablemente falta un evento.
- Los casos de uso dependen de los **puertos** (`RepositorioTurnos`), nunca de los adaptadores (`TurnosJdbc`).
- Los **controladores no tienen lógica**: validan la entrada, resuelven el local de la sesión (`LocalDeTrabajo`) y llaman
  a un caso de uso.
- Los **errores de negocio** se lanzan como `ErrorNegocio(codigo, mensaje, status)`. La API los convierte al sobre
  `{ok:false, error:{codigo, mensaje}}` y las páginas los muestran como aviso. No hay `try/catch` repartidos.
- Lo que debe pasar **después del commit** (revisar avisos, empujar SSE) se registra con `DespuesDelCommit.ejecutar(...)`
  o con un evento; nunca en medio de la transacción.

---

## 4. Datos

- **Fechas**: las columnas `TIMESTAMP(3)` (sin zona) guardan UTC. Cada conexión fija `TIME ZONE 'UTC'`
  (`BaseDatosConfig`). Para leer y escribir se usa `Sql.instante(rs, col)` y `Sql.utc(instante)`. Nunca
  `LocalDateTime.now()` ni la zona de la JVM: el reloj es el bean `Clock`.
- **Fecha del turno**: es la fecha en la zona del local (`Fechas.fechaLocal(zona, instante)`), no la del servidor.
- **Enums de PostgreSQL**: se leen con `columna::text` y se escriben con `CAST(:valor AS "NombreEnum")`.
- **Funciones SQL**: `emitir_turno`, `siguiente_turno`, `posicion_turno`, `tiempo_estimado` se llaman tal cual; no se
  reescriben en Java.
- **Multi-tenant**: el `localId` sale siempre de la sesión (`LocalDeTrabajo.resolver`), nunca del cuerpo de la petición.
  Todas las consultas del personal filtran por `local_id`.
- **Migraciones nuevas**: `backend/src/main/resources/db/migration/V12__descripcion.sql` en adelante. Mientras conviva
  el sistema anterior, solo cambios **aditivos** (columnas nuevas con valor por defecto, tablas nuevas).

---

## 5. Frontend

- Cada página es una plantilla completa que incluye `fragmentos/base :: cabeza(...)`. Los componentes repetidos
  (logo, insignia de estado, cabecera del local, indicador en vivo, menú de usuario) son fragmentos de
  `fragmentos/base.html`.
- **Actualización en vivo**: el contenedor de la página abre el SSE (`hx-ext="sse"` + `sse-connect`) y la zona que cambia
  se vuelve a pedir al servidor con `hx-trigger="sse:<evento> delay:300ms, every 20s"`. El servidor devuelve el
  fragmento (`"panel/panel :: contenido"`).
- **Acciones**: formularios con `hx-post` que devuelven el fragmento actualizado. Los mensajes van en la cabecera
  `HX-Trigger` (`Htmx.aviso(...)`) y `js/app.js` los muestra. Los errores de negocio también.
- **Mejora progresiva**: todo formulario con `hx-post` lleva también `method="post"` y `th:action` (así Thymeleaf
  agrega el campo CSRF). Si htmx no llegó a activarse, el formulario igual funciona y el controlador redirige a la página
  (`if (!Htmx.esPeticion(peticion)) return "redirect:…"`).
- **CSRF**: el token vive en la cookie `XSRF-TOKEN` y la página lo publica en `<meta name="_csrf">`; `app.js` lo envía
  en cada petición de htmx. No se rota en cada petición (la identidad es un JWT sin sesión de servidor): rotarlo
  invalidaría el token de la página en cuanto htmx refresca un fragmento.
- **Thymeleaf 3.1** no permite llamar beans dentro de `th:utext`: el HTML sin escapar (QR en SVG, avisos con negritas)
  lo prepara el controlador y la plantilla solo lo inserta.
- **JavaScript**: solo archivos pequeños por pantalla (`panel.js`, `tv.js`, `mi-turno.js`, `ticket.js`) más `app.js` y
  `sonido.js`. Sin `onclick` en el HTML (la CSP no lo permite): se usan atributos `data-*` y `addEventListener`.
- **CSS**: `tokens.css` (colores, radios, sombras), `componentes.css` (`.boton`, `.tarjeta`, `.insignia`, `.campo`…) y
  una hoja por pantalla en `css/pantallas/`. El color de cada local llega como `style="--local: #…"`.
- En desarrollo (`bootRun`, perfil `dev`) las plantillas y los estáticos se leen directo de `frontend/`.

---

## 6. Receta: migrar un módulo del sistema anterior

Ejemplo con M1 Prioridades. Lo mismo vale para M2–M8, pagos y la administración.

El código original ya no está en esta rama: su última versión está en el commit `bce0774`, carpeta `legacy/`. Se lee
sin cambiar de rama con `git ls-tree -r --name-only bce0774 legacy/backend/src/prioridades` y
`git show bce0774:legacy/backend/src/prioridades/<archivo>`.

1. **Leer el original**: `legacy/backend/src/prioridades/` (reglas y servicio), sus rutas en
   `legacy/frontend/src/app/api/v1/prioridades/**` y sus pantallas en `legacy/frontend/src/app/admin/modulos/prioridades/`.
   Las pruebas de `legacy/backend/tests/unit/prioridades.test.ts` dicen qué comportamiento conservar.
2. **Crear el paquete** `pe.turnoya.prioridades` con `package-info.java` (`@ApplicationModule`), `dominio/`,
   `infraestructura/` y un slice por funcionalidad (sección 3), por ejemplo `categorias/` y `verificacion/`.
3. **Reglas puras** a `dominio/` con sus pruebas (portar los casos de las pruebas del sistema anterior; para propiedades, jqwik).
4. **Casos de uso** al slice de su funcionalidad; **puertos** (`Repositorio*`) a `dominio/`; **SQL** a
   `infraestructura/*Jdbc`, que implementa el puerto y no es público.
5. **Conectar con el núcleo sin tocarlo**:
   - implementar el puerto que corresponda (`PoliticaPrioridad`) con `aplica(localId) = modulos.activo(localId, Modulo.M1)`;
   - escuchar los eventos que necesite (`TurnoCerrado`, `TurnoEmitido`) con `@ApplicationModuleListener`;
   - si el núcleo necesita algo nuevo, agregar un **puerto** o un **evento** en `nucleo.puertos` / `nucleo.eventos`, nunca
     una llamada directa del núcleo al módulo.
6. **API REST** (`*Api`) en el slice, con el **mismo contrato** que el sistema anterior (rutas, campos, códigos de error).
7. **Pantallas** en `frontend/src/main/resources/templates/<modulo>/` y su CSS en `static/css/pantallas/`.
   Agregar el enlace en `templates/admin/marco.html` (quitar el "en migración").
8. **Tareas programadas** como `@Bean TareaProgramada` con **el mismo nombre** que en `legacy/backend/src/jobs/registro.ts`.
9. **Verificar**: `gradlew build` (incluye `ModularidadTest` y `ArquitecturaHexagonalTest`). Si el módulo cifra o firma algo, agregar sus casos al
   generador de vectores dorados.
10. **Corte**: cuando la versión Java está en producción, se retira esa ruta del sistema anterior.

---

## 7. Pruebas

| Tipo | Dónde | Qué cubre |
|---|---|---|
| Unitarias | `src/test/java/.../dominio`, `EstadoTurnoTest`, `HorarioAtencionTest`… | Reglas puras, sin Spring |
| Modularidad | `ModularidadTest` | Fronteras y ciclos entre módulos; genera los diagramas |
| Compatibilidad | `CompatibilidadLegacyTest` + `src/test/resources/vectores/compatibilidad.json` | Celulares, cifrado, bcrypt y JWT idénticos al sistema anterior |
| Integración | `NucleoIntegracionTest` (Testcontainers) | Migraciones desde cero, numeración, RN03, 3 ventanillas concurrentes, contrato de la API pública |

Los vectores dorados se generaron con `legacy/backend/scripts/generar-vectores.ts` (commit `bce0774`). Solo hace falta
regenerarlos si cambia el cifrado o la firma de sesiones del sistema anterior; se hace desde ese commit:

```bash
git worktree add ../turnoya-anterior bce0774
cd ../turnoya-anterior/legacy/backend
npx tsx scripts/generar-vectores.ts
```

Las pruebas de integración necesitan Docker; sin él se omiten (en CI siempre corren).

---

## 8. Convivencia con el sistema anterior

- **Base de datos**: una sola. Flyway (Java) es el dueño del esquema a partir de ahora. Para una BD nueva con datos de
  demostración: primero `npm run setup` en el sistema anterior (crea y siembra), luego Java la toma como
  base (versión 10). En una BD vacía Flyway crea el esquema completo, sin datos de demostración.
- **Sesión**: la misma cookie y el mismo `JWT_SECRET`.
- **Tareas**: las del núcleo (`expirar-llamados`) se reclaman en `job_estado`; si corren ambos sistemas, una sola instancia
  ejecuta cada corrida.
- **Tiempo real**: cada sistema tiene su propio canal SSE. Mientras convivan, conviene que las pantallas de un local usen
  un solo sistema.
- **Puertos**: Java en 8080, el sistema anterior en 3000. En producción, un proxy (Nginx/Caddy) decide por ruta qué sistema responde,
  y se mueve una ruta a Java cuando su módulo está migrado.
