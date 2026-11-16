package pe.turnoya.nucleo.avisos;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.nucleo.eventos.TurnoAvisado;
import pe.turnoya.nucleo.eventos.TurnoCambioEstado;
import pe.turnoya.nucleo.dominio.RepositorioColas;
import pe.turnoya.nucleo.dominio.RepositorioTurnos;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;

/**
 * RF03: avisa a quienes les faltan {@code local.avisarFaltando} personas o menos. Cada turno pasa a AVISADO una sola
 * vez (guarda optimista) y se publica {@link TurnoAvisado}; el módulo de notificaciones decide cómo avisar.
 *
 * <p>Se llama después del commit de la operación que movió la cola, por eso abre su propia transacción.
 */
@Service
public class AvisosCola {

    private final RepositorioTurnos turnos;
    private final RepositorioColas colas;
    private final CatalogoLocales locales;
    private final ApplicationEventPublisher eventos;
    private final Clock reloj;

    AvisosCola(RepositorioTurnos turnos, RepositorioColas colas, CatalogoLocales locales, ApplicationEventPublisher eventos, Clock reloj) {
        this.turnos = turnos;
        this.colas = colas;
        this.locales = locales;
        this.eventos = eventos;
        this.reloj = reloj;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void revisar(int colaId) {
        var cola = colas.porId(colaId);
        if (cola.isEmpty()) {
            return;
        }
        Local local = locales.exigir(cola.get().localId());
        Instant ahora = reloj.instant();
        int avisar = local.avisarFaltando();
        List<Turno> primeros = turnos.primerosEnEspera(colaId, Fechas.fechaLocal(local.zonaHoraria(), ahora), avisar + 1);
        for (int delante = 0; delante < primeros.size() && delante <= avisar; delante++) {
            Turno t = primeros.get(delante);
            if (t.estado() != EstadoTurno.EMITIDO || !turnos.transicionar(t.id(), EstadoTurno.EMITIDO, EstadoTurno.AVISADO, ahora)) {
                continue;
            }
            eventos.publishEvent(new TurnoCambioEstado(local.id(), t.id(), t.token(), EstadoTurno.AVISADO));
            eventos.publishEvent(new TurnoAvisado(local.id(), t.id(), delante));
        }
        eventos.publishEvent(new ColaActualizada(local.id(), colaId));
    }
}
