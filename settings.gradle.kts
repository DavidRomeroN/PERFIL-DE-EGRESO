// TurnoYa — proyecto Java (Spring Boot + Thymeleaf + HTMX)
//   backend/   aplicación Spring Boot: módulos de negocio (Spring Modulith), API REST y controladores de vistas
//   frontend/  plantillas Thymeleaf, CSS y el JavaScript mínimo (se empaqueta como recursos del backend)
// El sistema anterior (Next.js) vive en legacy/ hasta terminar la migración.
rootProject.name = "turnoya"

dependencyResolutionManagement {
    // Un solo lugar para los repositorios: ningún subproyecto declara los suyos
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        mavenCentral()
    }
}

include("backend", "frontend")
