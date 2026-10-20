// Frontend: solo recursos (templates/ y static/). Se empaqueta como un jar que el backend pone en su classpath,
// así Spring Boot lo sirve sin herramientas de JavaScript ni paso de compilación.
plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

dependencies {
    api(platform(org.springframework.boot.gradle.plugin.SpringBootPlugin.BOM_COORDINATES))
    // htmx y su extensión SSE como WebJars: versión fija aquí, servidos en /webjars/** sin copiar archivos al repo
    api(libs.htmx)
    api(libs.htmx.sse)
    api("org.webjars:webjars-locator-lite")
}
