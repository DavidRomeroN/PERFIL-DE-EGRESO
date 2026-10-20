package pe.turnoya.nucleo.aplicacion;

import java.time.Clock;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.datos.DespuesDelCommit;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.nucleo.eventos.TurnoCambioEstado;
import pe.turnoya.nucleo.eventos.TurnoCerrado;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc;

/** RF04: el cliente cancela su turno desde el enlace de seguimiento. */
@Service
public class CancelacionTurnos {

    private final TurnosJdbc turnos;
    private final AvisosCola avisos;
    private final ConsultaTurnos consulta;
    private final ApplicationEventPublisher eventos;
    private final Clock reloj;

    CancelacionTurnos(TurnosJdbc turnos, AvisosCola avisos, ConsultaTurnos consulta, ApplicationEventPublisher eventos, Clock reloj) {
        this.turnos = turnos;
        this.avisos = avisos;
        this.consulta = consulta;
        this.eventos = eventos;
        this.reloj = reloj;
    }

    @Transactional
    public TurnoPublico cancelar(String token) {
        Turno t = turnos.porToken(token).orElseThrow(() -> ErrorNegocio.noEncontrado("TURNO_NO_ENCONTRADO", "El turno no existe"));
        if (!t.estado().puedePasarA(EstadoTurno.CANCELADO)) {
            throw ErrorNegocio.conflicto("TRANSICION_INVALIDA", "No se puede cancelar un turno en estado " + t.estado());
        }
        if (!turnos.transicionar(t.id(), t.estado(), EstadoTurno.CANCELADO, reloj.instant())) {
            throw ErrorNegocio.conflicto("TRANSICION_INVALIDA", "El turno cambió de estado, vuelve a intentarlo");
        }
        eventos.publishEvent(new TurnoCambioEstado(t.localId(), t.id(), t.token(), EstadoTurno.CANCELADO));
        eventos.publishEvent(new ColaActualizada(t.localId(), t.colaId()));
        eventos.publishEvent(new TurnoCerrado(t.localId(), t.id(), t.citaId(), EstadoTurno.CANCELADO));
        DespuesDelCommit.ejecutar(() -> avisos.revisar(t.colaId()));
        return consulta.porToken(token);
    }
}
