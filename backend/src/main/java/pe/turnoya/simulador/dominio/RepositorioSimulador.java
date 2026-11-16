package pe.turnoya.simulador.dominio;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/** Puerto de salida del simulador: lee el histórico de turnos de una cola y guarda escenarios. */
public interface RepositorioSimulador {

    record Cola(int id, String nombre, int tiempoAtencionBaseSeg) {
    }

    /** Colas activas del local, en su orden. */
    List<Cola> colas(int localId);

    Optional<Cola> cola(int localId, int colaId);

    /** Un turno del histórico: lo justo para calibrar y validar. */
    record TurnoHistorico(LocalDate fecha, Instant emitidoAt, Instant llamadoAt, Instant finalizadoAt, String estado, Integer ventanillaId,
                          boolean transferido) {
    }

    /** Turnos de la cola con fecha (del local) en [desde, hasta). */
    List<TurnoHistorico> turnos(int colaId, LocalDate desde, LocalDate hasta);

    record Escenario(int id, String nombre, Integer colaId, int semilla, Instant creadoAt, String parametrosJson, Double pctSla, Double esperaMedia) {
    }

    List<Escenario> escenarios(int localId);

    Optional<Escenario> escenario(int localId, int id);

    int contarEscenarios(int localId);

    int crearEscenario(int localId, String nombre, Integer colaId, String parametrosJson, String resultadosJson, int semilla, Integer usuarioId);

    boolean eliminarEscenario(int localId, int id);
}
