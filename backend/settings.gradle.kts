// TurnoYa — proyecto Java (Spring Boot + Thymeleaf + htmx). Se compila desde esta carpeta (backend/):
//   gradlew bootRun   ·   gradlew build
// La aplicación es este proyecto; ../frontend (plantillas, CSS y JavaScript) se incluye como subproyecto de recursos.
rootProject.name = "turnoya"

dependencyResolutionManagement {
    // Un solo lugar para los repositorios: ningún subproyecto declara los suyos
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        mavenCentral()
    }
}

include("frontend")
project(":frontend").projectDir = file("../frontend")
