package pe.turnoya.notificaciones.aplicacion;

import java.util.List;
import org.springframework.stereotype.Component;
import pe.turnoya.notificaciones.infraestructura.NotificacionesJdbc;
import pe.turnoya.nucleo.puertos.AvisosDelTurno;

/** Implementa el puerto del núcleo para mostrar los avisos enviados en "mi turno". */
@Component
class HistorialAvisos implements AvisosDelTurno {

    private final NotificacionesJdbc notificaciones;

    HistorialAvisos(NotificacionesJdbc notificaciones) {
        this.notificaciones = notificaciones;
    }

    @Override
    public List<AvisoEnviado> deTurno(int turnoId) {
        return notificaciones.deTurno(turnoId);
    }
}
