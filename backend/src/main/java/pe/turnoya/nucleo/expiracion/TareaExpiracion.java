package pe.turnoya.nucleo.expiracion;

import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import pe.turnoya.compartido.tareas.TareaProgramada;

/** Tarea programada de la expiración (mismo nombre que en el sistema anterior para compartir el reclamo en {@code job_estado}). */
@Configuration(proxyBeanMethods = false)
class TareaExpiracion {

    @Bean
    TareaProgramada expirarLlamados(ExpiracionLlamados expiracion) {
        return TareaProgramada.cada("expirar-llamados", Duration.ofSeconds(15),
                "RN04: LLAMADO sin presentarse ⇒ NO_SE_PRESENTO (solo locales con tiempo de ausencia)", expiracion::ejecutar);
    }

    @Bean
    TareaProgramada cerrarJornada(CierreJornada cierre) {
        return TareaProgramada.cada("cerrar-jornada", Duration.ofMinutes(15),
                "Turnos en espera de días anteriores ⇒ CANCELADO (no cuentan como falta)", cierre::ejecutar);
    }
}
