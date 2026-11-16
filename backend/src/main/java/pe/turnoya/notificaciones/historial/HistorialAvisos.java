package pe.turnoya.notificaciones.historial;

import java.util.List;
import org.springframework.stereotype.Component;
import pe.turnoya.notificaciones.dominio.RepositorioNotificaciones;
import pe.turnoya.nucleo.puertos.AvisosDelTurno;

/** Implementa el puerto del núcleo para mostrar los avisos enviados en "mi turno". */
@Component
class HistorialAvisos implements AvisosDelTurno {

    private final RepositorioNotificaciones notificaciones;

    HistorialAvisos(RepositorioNotificaciones notificaciones) {
        this.notificaciones = notificaciones;
    }

    @Override
    public List<AvisoEnviado> deTurno(int turnoId) {
        return notificaciones.deTurno(turnoId);
    }
}
