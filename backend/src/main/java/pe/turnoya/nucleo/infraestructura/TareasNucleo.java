package pe.turnoya.nucleo.infraestructura;

import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import pe.turnoya.compartido.tareas.TareaProgramada;
import pe.turnoya.nucleo.aplicacion.ExpiracionLlamados;

/** Tareas programadas del núcleo (mismos nombres que en legacy/ para compartir el reclamo en {@code job_estado}). */
@Configuration(proxyBeanMethods = false)
class TareasNucleo {

    @Bean
    TareaProgramada expirarLlamados(ExpiracionLlamados expiracion) {
        return TareaProgramada.cada("expirar-llamados", Duration.ofSeconds(15),
                "RN04: LLAMADO sin presentarse ⇒ NO_SE_PRESENTO (solo locales con tiempo de ausencia)", expiracion::ejecutar);
    }
}
