# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# TurnoYa — imagen de producción (Spring Boot con las plantillas de frontend/ dentro del jar)
# Se construye desde la raíz del repositorio (necesita backend/ y frontend/):
#   docker build -f backend/Dockerfile .
# ---------------------------------------------------------------------------

# 1) Compilación con el wrapper de Gradle (misma versión que en desarrollo)
FROM eclipse-temurin:21-jdk AS compilacion
WORKDIR /app/backend
COPY backend/gradlew backend/settings.gradle.kts backend/build.gradle.kts backend/gradle.properties ./
COPY backend/gradle ./gradle
COPY frontend/build.gradle.kts /app/frontend/build.gradle.kts
# Descarga dependencias en una capa propia (se reutiliza mientras no cambien los build.gradle.kts)
RUN --mount=type=cache,target=/root/.gradle ./gradlew --no-daemon dependencies -q > /dev/null
COPY backend/src ./src
COPY frontend/src /app/frontend/src
RUN --mount=type=cache,target=/root/.gradle ./gradlew --no-daemon bootJar -x test \
    && java -Djarmode=tools -jar build/libs/turnoya-*[0-9].jar extract --layers --launcher --destination /app/extraido

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
# Flyway aplica las migraciones al arrancar
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
