// Configuración común a backend/ y frontend/. El plugin de Spring Boot se declara aquí sin aplicarlo
// para que su clase SpringBootPlugin (coordenadas del BOM) esté disponible en ambos subproyectos.
plugins {
    alias(libs.plugins.spring.boot) apply false
}

subprojects {
    group = "pe.turnoya"
    version = "0.3.0"

    tasks.withType<JavaCompile>().configureEach {
        options.encoding = "UTF-8"
        // -parameters: Spring resuelve @PathVariable/@RequestParam por nombre sin repetirlo en la anotación
        options.compilerArgs.addAll(listOf("-parameters", "-Xlint:unchecked", "-Xlint:deprecation"))
    }
}
