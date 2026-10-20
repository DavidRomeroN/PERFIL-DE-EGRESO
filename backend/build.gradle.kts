import org.springframework.boot.gradle.plugin.SpringBootPlugin

plugins {
    java
    alias(libs.plugins.spring.boot)
}

java {
    toolchain {
        // Java 21: virtual threads para las conexiones SSE (pantallas TV y celulares)
        languageVersion = JavaLanguageVersion.of(21)
    }
}

dependencies {
    implementation(platform(SpringBootPlugin.BOM_COORDINATES))
    implementation(platform(libs.spring.modulith.bom))

    // Plantillas, CSS y JS (subproyecto frontend/)
    implementation(project(":frontend"))

    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-thymeleaf")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation("org.flywaydb:flyway-database-postgresql")

    // Monolito modular: fronteras entre módulos y eventos con registro de publicaciones (outbox)
    implementation("org.springframework.modulith:spring-modulith-starter-core")
    implementation("org.springframework.modulith:spring-modulith-starter-jdbc")

    // Sesión compatible con la de legacy/ (JWT HS256 en cookie)
    implementation(libs.nimbus.jose.jwt)
    // Códigos QR en SVG generados en el servidor (TV y ticket impreso)
    implementation(libs.zxing.core)

    runtimeOnly("org.postgresql:postgresql")
    runtimeOnly("io.micrometer:micrometer-registry-prometheus")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.springframework.modulith:spring-modulith-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-postgresql")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
    // Las fechas de la BD se guardan en UTC (ver BaseDatosConfig): las pruebas corren en la misma zona que producción
    systemProperty("user.timezone", "UTC")
}

tasks.named<org.springframework.boot.gradle.tasks.run.BootRun>("bootRun") {
    // Perfil de desarrollo: plantillas y estáticos se leen directo de frontend/ (cambios sin reiniciar)
    systemProperty("spring.profiles.active", System.getenv("SPRING_PROFILES_ACTIVE") ?: "dev")
    systemProperty("user.timezone", "UTC")
}
