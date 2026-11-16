# TurnoYa — instrucciones para trabajar en este repositorio

- **Proyecto**: Java 21 + Spring Boot 4 (Spring Modulith) en `backend/` y plantillas Thymeleaf + htmx en
  `frontend/`. El proyecto Gradle vive en `backend/` (incluye `../frontend` como subproyecto): dentro de `backend/`,
  `gradlew build` y `gradlew bootRun`.
- **Sistema anterior** (Next.js + Prisma): ya no está en esta rama; su última versión está en el
  commit `bce0774` (carpeta `legacy/`). Consúltalo con `git show bce0774:legacy/<ruta>` al migrar un módulo.
- **Arquitectura y convenciones**: [`docs/ARQUITECTURA_JAVA.md`](docs/ARQUITECTURA_JAVA.md). Antes de migrar un módulo,
  sigue la receta de su sección 6.

Reglas que no se negocian:

1. Un módulo no usa clases internas de otro ni crea ciclos: `ModularidadTest` debe pasar.
2. El núcleo no llama a los módulos opcionales: se comunican por eventos (`nucleo.eventos`) y puertos (`nucleo.puertos`).
3. Fechas en UTC (`Sql.utc`, `Sql.instante`, bean `Clock`); la fecha del turno es la de la zona del local.
4. El `localId` sale de la sesión (`LocalDeTrabajo`), nunca del cuerpo de la petición.
5. La API `/api/v1` mantiene el contrato del sistema anterior (sobre `{ok, data}` / `{ok:false, error:{codigo, mensaje}}`).
6. Sin JavaScript en línea ni `onclick` (CSP `script-src 'self'`); comportamiento en `static/js/*.js` con `data-*`.
7. Textos de la interfaz, nombres de clases y comentarios en español, como el resto del código.
