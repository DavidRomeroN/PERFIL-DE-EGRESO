# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# TurnoYa — imagen de producción (Spring Boot: backend/ + frontend/ en un solo jar)
# El sistema anterior tiene su propia imagen en legacy/Dockerfile.
# ---------------------------------------------------------------------------

# 1) Compilación con el wrapper de Gradle (misma versión que en desarrollo)
FROM eclipse-temurin:21-jdk AS compilacion
WORKDIR /app
COPY gradlew settings.gradle.kts build.gradle.kts gradle.properties ./
COPY gradle ./gradle
COPY backend/build.gradle.kts ./backend/build.gradle.kts
COPY frontend/build.gradle.kts ./frontend/build.gradle.kts
# Descarga dependencias en una capa propia (se reutiliza mientras no cambien los build.gradle.kts)
RUN --mount=type=cache,target=/root/.gradle ./gradlew --no-daemon :backend:dependencies -q > /dev/null
COPY backend/src ./backend/src
COPY frontend/src ./frontend/src
RUN --mount=type=cache,target=/root/.gradle ./gradlew --no-daemon :backend:bootJar -x test \
    && java -Djarmode=tools -jar backend/build/libs/backend-*.jar extract --layers --launcher --destination /app/extraido

# 2) Ejecución: solo el JRE y las capas del jar (dependencias primero: cambian poco)
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S turnoya && adduser -S turnoya -G turnoya
COPY --from=compilacion --chown=turnoya:turnoya /app/extraido/dependencies/ ./
COPY --from=compilacion --chown=turnoya:turnoya /app/extraido/spring-boot-loader/ ./
COPY --from=compilacion --chown=turnoya:turnoya /app/extraido/snapshot-dependencies/ ./
COPY --from=compilacion --chown=turnoya:turnoya /app/extraido/application/ ./
USER turnoya
ENV SPRING_PROFILES_ACTIVE=prod \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -Duser.timezone=UTC"
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
# Flyway aplica las migraciones al arrancar (V1–V10 de legacy/ + las nuevas)
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
