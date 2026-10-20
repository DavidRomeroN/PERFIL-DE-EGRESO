package pe.turnoya;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;
import org.springframework.modulith.docs.Documenter;

/**
 * Fronteras entre módulos: falla si un módulo usa clases internas de otro o si aparece un ciclo
 * (por ejemplo, que el núcleo dependa de notificaciones). Es la guarda contra el "código en cascada".
 */
class ModularidadTest {

    private final ApplicationModules modulos = ApplicationModules.of(TurnoYaApplication.class);

    @Test
    void losModulosRespetanSusFronteras() {
        modulos.verify();
    }

    /** Diagramas de módulos (PlantUML) y fichas por módulo en backend/build/spring-modulith-docs. */
    @Test
    void generaDocumentacionDeModulos() {
        new Documenter(modulos).writeDocumentation();
    }
}
