package pe.turnoya.prediccion.entrenamiento;

import java.time.Duration;
import java.time.LocalTime;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import pe.turnoya.compartido.tareas.TareaProgramada;

/** Jobs de M2 (mismos nombres que el sistema anterior para compartir el reclamo en {@code job_estado}). */
@Configuration(proxyBeanMethods = false)
class TareasPrediccion {

    @Bean
    TareaProgramada prediccionReentrenar(EntrenamientoModelos entrenamiento) {
        return TareaProgramada.diaria("prediccion-reentrenar", LocalTime.of(2, 0),
                "M2: reentrena BASELINE/EMA/ESTACIONAL por cola (walk-forward, AUTO)", entrenamiento::jobReentrenar);
    }

    @Bean
    TareaProgramada prediccionDeriva(EntrenamientoModelos entrenamiento) {
        return TareaProgramada.cada("prediccion-deriva", Duration.ofMinutes(10), "M2: detecta deriva del modelo en producción", entrenamiento::jobDeriva);
    }
}
