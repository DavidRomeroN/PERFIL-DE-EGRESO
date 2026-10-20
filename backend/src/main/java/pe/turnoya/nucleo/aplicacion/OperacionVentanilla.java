package pe.turnoya.nucleo.aplicacion;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.datos.DespuesDelCommit;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.nucleo.dominio.Ventanilla;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.nucleo.eventos.TurnoCambioEstado;
import pe.turnoya.nucleo.eventos.TurnoCerrado;
import pe.turnoya.nucleo.eventos.TurnoLlamado;
import pe.turnoya.nucleo.infraestructura.ColasJdbc;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc;
import pe.turnoya.nucleo.infraestructura.VentanillasJdbc;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;

/** Operación de ventanilla (RF05, RF06): llamar al siguiente, atender, rellamar, no se presentó. */
@Service
public class OperacionVentanilla {

    private final TurnosJdbc turnos;
    private final VentanillasJdbc ventanillas;
    private final ColasJdbc colas;
    private final CatalogoLocales locales;
    private final Auditoria auditoria;
    private final AvisosCola avisos;
    private final ConsultaTurnos consulta;
    private final ApplicationEventPublisher eventos;
    private final MeterRegistry metricas;
    private final Clock reloj;

    OperacionVentanilla(TurnosJdbc turnos, VentanillasJdbc ventanillas, ColasJdbc colas, CatalogoLocales locales, Auditoria auditoria,
                        AvisosCola avisos, ConsultaTurnos consulta, ApplicationEventPublisher eventos, MeterRegistry metricas, Clock reloj) {
        this.turnos = turnos;
        this.ventanillas = ventanillas;
        this.colas = colas;
        this.locales = locales;
        this.auditoria = auditoria;
        this.avisos = avisos;
        this.consulta = consulta;
        this.eventos = eventos;
        this.metricas = metricas;
        this.reloj = reloj;
    }

    /**
     * Cierra como ATENDIDO el turno que tenía la ventanilla y llama al siguiente. La selección ocurre en SQL con
     * {@code FOR UPDATE SKIP LOCKED} dentro de esta transacción: dos ventanillas nunca toman el mismo turno (C2).
     *
     * @return el turno llamado, o vacío si no hay nadie en espera
     */
    @Transactional
    public Optional<TurnoPublico> llamarSiguiente(int ventanillaId, int localId, Auditoria.Actor actor) {
        auditoria.fijarActor(actor);
        Ventanilla ventanilla = ventanillas.porIdEnLocal(ventanillaId, localId).filter(Ventanilla::activa)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("VENTANILLA_INVALIDA", "La ventanilla no existe o está inactiva"));
        Local local = locales.exigir(localId);
        Instant ahora = reloj.instant();

        turnos.llamadoEnVentanilla(ventanilla.id()).ifPresent(enCurso -> {
            if (turnos.transicionar(enCurso.id(), EstadoTurno.LLAMADO, EstadoTurno.ATENDIDO, ahora)) {
                eventos.publishEvent(new TurnoCambioEstado(localId, enCurso.id(), enCurso.token(), EstadoTurno.ATENDIDO));
                eventos.publishEvent(new TurnoCerrado(localId, enCurso.id(), enCurso.citaId(), EstadoTurno.ATENDIDO));
            }
        });

        Optional<Turno> llamado = turnos.siguiente(localId, ventanilla.colaId(), Fechas.fechaLocal(local.zonaHoraria(), ahora))
                .map(id -> {
                    turnos.marcarLlamado(id, ventanilla.id(), ahora);
                    return turnos.porId(id).orElseThrow();
                });
        llamado.ifPresent(t -> {
            metricas.counter("turnos_llamados_total").increment();
            String cola = colas.porId(t.colaId()).map(c -> c.nombre()).orElse("");
            eventos.publishEvent(new TurnoLlamado(localId, t.id(), t.codigo(), t.token(), ventanilla.nombre(), cola, false, t.codigoProvisional()));
            eventos.publishEvent(new TurnoCambioEstado(localId, t.id(), t.token(), EstadoTurno.LLAMADO));
            DespuesDelCommit.ejecutar(() -> avisos.revisar(t.colaId()));
        });
        eventos.publishEvent(new ColaActualizada(localId, null));
        return llamado.map(t -> consulta.porToken(t.token()));
    }

    /** Atendido, no se presentó o rellamar (LLAMADO → LLAMADO). Para transferir está el módulo M6. */
    @Transactional
    public Turno cambiarEstado(int turnoId, int localId, EstadoTurno nuevo, Auditoria.Actor actor) {
        auditoria.fijarActor(actor);
        Turno t = turnos.porIdEnLocal(turnoId, localId)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("TURNO_NO_ENCONTRADO", "El turno no existe"));
        if (nuevo == EstadoTurno.TRANSFERIDO) {
            throw ErrorNegocio.conflicto("TRANSICION_INVALIDA", "Usa la acción Transferir para mover el turno");
        }
        if (!t.estado().puedePasarA(nuevo)) {
            throw ErrorNegocio.conflicto("TRANSICION_INVALIDA", "Transición " + t.estado() + " → " + nuevo + " no permitida");
        }
        // Guarda optimista: si otro proceso cambió el estado (p. ej. la expiración RN04), no se pisa
        if (!turnos.transicionar(t.id(), t.estado(), nuevo, reloj.instant())) {
            throw ErrorNegocio.conflicto("TRANSICION_INVALIDA", "El turno cambió de estado, actualiza la pantalla");
        }
        Turno actualizado = turnos.porId(t.id()).orElseThrow();

        if (nuevo == EstadoTurno.LLAMADO) {
            String ventanilla = t.ventanillaId() == null ? ""
                    : ventanillas.porIdEnLocal(t.ventanillaId(), localId).map(Ventanilla::nombre).orElse("");
            String cola = colas.porId(t.colaId()).map(c -> c.nombre()).orElse("");
            eventos.publishEvent(new TurnoLlamado(localId, t.id(), t.codigo(), t.token(), ventanilla, cola, true, t.codigoProvisional()));
        }
        eventos.publishEvent(new TurnoCambioEstado(localId, t.id(), t.token(), nuevo));
        eventos.publishEvent(new ColaActualizada(localId, t.colaId()));
        if (nuevo.finalizado()) {
            eventos.publishEvent(new TurnoCerrado(localId, t.id(), t.citaId(), nuevo));
        }
        return actualizado;
    }
}
