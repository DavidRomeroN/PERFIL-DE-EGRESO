package pe.turnoya;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.stereotype.Controller;
import org.springframework.stereotype.Repository;
import org.springframework.web.bind.annotation.RestController;

/**
 * Reglas de la arquitectura hexagonal dentro de cada módulo (las fronteras entre módulos las revisa
 * {@link ModularidadTest}). Cada módulo tiene:
 * <ul>
 *   <li>{@code dominio/}: modelo, reglas puras y puertos de salida ({@code Repositorio*}). No conoce la BD ni la web.</li>
 *   <li>{@code infraestructura/}: adaptadores de salida (JDBC, WhatsApp, Redis) que implementan los puertos.</li>
 *   <li>una carpeta por funcionalidad (vertical slice): sus casos de uso y sus adaptadores de entrada (API, vistas).</li>
 * </ul>
 */
class ArquitecturaHexagonalTest {

    private static JavaClasses clases;

    @BeforeAll
    static void importar() {
        clases = new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS).importPackages("pe.turnoya");
    }

    @Test
    void elDominioNoConoceLaBaseDeDatosNiLaWeb() {
        noClasses().that().resideInAPackage("..dominio..")
                .should().dependOnClassesThat().resideInAnyPackage("..infraestructura..", "org.springframework.jdbc..",
                        "org.springframework.web..", "jakarta.servlet..")
                .check(clases);
    }

    @Test
    void elDominioNoDependeDeLasFuncionalidades() {
        classes().that().resideInAPackage("..dominio..")
                .should().onlyDependOnClassesThat().resideInAnyPackage("java..", "javax.crypto..", "org.slf4j..", "org.springframework.stereotype..",
                        "..dominio..", "pe.turnoya.compartido..",
                        // API pública de los módulos (paquete raíz) e interfaces nombradas del núcleo
                        "pe.turnoya.nucleo", "pe.turnoya.plataforma", "pe.turnoya.notificaciones", "pe.turnoya.tiemporeal",
                        "pe.turnoya.nucleo.eventos..", "pe.turnoya.nucleo.puertos..")
                .check(clases);
    }

    @Test
    void soloLaInfraestructuraUsaLosAdaptadores() {
        noClasses().that().resideOutsideOfPackage("..infraestructura..")
                .should().dependOnClassesThat().resideInAPackage("..infraestructura..")
                .check(clases);
    }

    @Test
    void elSqlViveEnLosAdaptadores() {
        // compartido es la base técnica (planificador, límite de peticiones) y salud solo hace un SELECT 1
        noClasses().that().resideOutsideOfPackages("..infraestructura..", "pe.turnoya.compartido..", "pe.turnoya.plataforma.salud..")
                .should().dependOnClassesThat().resideInAPackage("org.springframework.jdbc..")
                .check(clases);
    }

    @Test
    void losRepositoriosSonAdaptadoresDeInfraestructura() {
        classes().that().areAnnotatedWith(Repository.class)
                .should().resideInAPackage("..infraestructura..")
                .andShould().notBePublic()
                .check(clases);
    }

    @Test
    void losControladoresVivenEnSuFuncionalidad() {
        classes().that().areAnnotatedWith(Controller.class).or().areAnnotatedWith(RestController.class)
                .should().resideOutsideOfPackages("..dominio..", "..infraestructura..")
                .check(clases);
    }
}
