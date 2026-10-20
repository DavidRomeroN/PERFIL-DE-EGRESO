package pe.turnoya.nucleo.aplicacion;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.nucleo.eventos.TurnoCambioEstado;
import pe.turnoya.nucleo.eventos.TurnoCerrado;
import pe.turnoya.nucleo.eventos.TurnoVencido;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;

/**
 * RN04 (N04): un turno LLAMADO que no se presenta en {@code local.tiempo_ausencia_seg} pasa a NO_SE_PRESENTO.
 * Es opcional por local (NULL = desactivado). Se ejecuta como tarea programada cada 15 s.
 */
@Service
public class ExpiracionLlamados {

    private final TurnosJdbc turnos;
    private final CatalogoLocales locales;
    private final ApplicationEventPublisher eventos;
    private final Clock reloj;

    ExpiracionLlamados(TurnosJdbc turnos, CatalogoLocales locales, ApplicationEventPublisher eventos, Clock reloj) {
        this.turnos = turnos;
        this.locales = locales;
        this.eventos = eventos;
        this.reloj = reloj;
    }

    @Transactional
    public Map<String, Integer> ejecutar() {
        Instant ahora = reloj.instant();
        int vencidos = 0;
        for (Local local : locales.activos()) {
            if (local.tiempoAusenciaSeg() == null) {
                continue;
            }
            for (Turno t : turnos.llamadosVencidos(local.id(), ahora.minusSeconds(local.tiempoAusenciaSeg()))) {
                if (!turnos.transicionar(t.id(), EstadoTurno.LLAMADO, EstadoTurno.NO_SE_PRESENTO, ahora)) {
                    continue;
                }
                eventos.publishEvent(new TurnoCambioEstado(local.id(), t.id(), t.token(), EstadoTurno.NO_SE_PRESENTO));
                eventos.publishEvent(new ColaActualizada(local.id(), t.colaId()));
                eventos.publishEvent(new TurnoVencido(local.id(), t.id()));
                eventos.publishEvent(new TurnoCerrado(local.id(), t.id(), t.citaId(), EstadoTurno.NO_SE_PRESENTO));
                vencidos++;
            }
        }
        return Map.of("vencidos", vencidos);
    }
}
