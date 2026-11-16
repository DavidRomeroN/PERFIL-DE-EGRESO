package pe.turnoya.nucleo.expiracion;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.dominio.RepositorioTurnos;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.nucleo.eventos.TurnoCambioEstado;
import pe.turnoya.nucleo.eventos.TurnoCerrado;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;

/**
 * Cierre de jornada: los turnos que quedaron en espera de un día anterior (fecha del local) se cancelan. Sin esto
 * quedarían «en curso» para siempre: en la app, en la analítica y bloqueando que el mismo cliente saque otro turno en
 * esa cola. Se cancelan y no se marcan «no se presentó»: nadie los llamó, así que no cuentan como falta del cliente.
 */
@Service
public class CierreJornada {

    private final RepositorioTurnos turnos;
    private final CatalogoLocales locales;
    private final ApplicationEventPublisher eventos;
    private final Clock reloj;

    CierreJornada(RepositorioTurnos turnos, CatalogoLocales locales, ApplicationEventPublisher eventos, Clock reloj) {
        this.turnos = turnos;
        this.locales = locales;
        this.eventos = eventos;
        this.reloj = reloj;
    }

    @Transactional
    public Map<String, Integer> ejecutar() {
        Instant ahora = reloj.instant();
        int cerrados = 0;
        for (Local local : locales.activos()) {
            LocalDate hoy = Fechas.fechaLocal(local.zonaHoraria(), ahora);
            Set<Integer> colas = new HashSet<>();
            for (Turno t : turnos.enEsperaAntesDe(local.id(), hoy)) {
                if (!turnos.transicionar(t.id(), t.estado(), EstadoTurno.CANCELADO, ahora)) {
                    continue;
                }
                eventos.publishEvent(new TurnoCambioEstado(local.id(), t.id(), t.token(), EstadoTurno.CANCELADO));
                eventos.publishEvent(new TurnoCerrado(local.id(), t.id(), t.citaId(), EstadoTurno.CANCELADO));
                colas.add(t.colaId());
                cerrados++;
            }
            colas.forEach(c -> eventos.publishEvent(new ColaActualizada(local.id(), c)));
        }
        return Map.of("cerrados", cerrados);
    }
}
