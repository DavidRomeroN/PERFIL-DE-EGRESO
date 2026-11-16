package pe.turnoya.analitica.alertas;

import java.util.Map;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Component;
import pe.turnoya.prediccion.DerivaDetectada;

/** Alertas de sistema que llegan por evento: deriva del modelo de espera (M2). */
@Component
class AlertasPorEvento {

    private final MotorAlertas motor;

    AlertasPorEvento(MotorAlertas motor) {
        this.motor = motor;
    }

    @ApplicationModuleListener
    void deriva(DerivaDetectada e) {
        motor.deSistema(e.localId(), "PREDICCION_DERIVA", "cola:" + e.colaId(), "El modelo de espera perdió precisión (" + e.modelo() + ")",
                Map.of("maeProduccionMin", e.maeProduccionMin(), "maeValidacionMin", e.maeValidacionMin()));
    }
}
