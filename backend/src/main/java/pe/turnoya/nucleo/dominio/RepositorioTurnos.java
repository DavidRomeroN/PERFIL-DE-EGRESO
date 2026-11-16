package pe.turnoya.nucleo.dominio;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import pe.turnoya.nucleo.CanalTurno;
import pe.turnoya.nucleo.EstadoTurno;

/** Puerto de salida: Turnos del local: emisión, transiciones de estado, colas de espera e historial. Lo implementa {@code infraestructura.TurnosJdbc}. */
public interface RepositorioTurnos {

    Optional<Turno> porToken(String token);

    Optional<Turno> porId(int id);

    Optional<Turno> porIdEnLocal(int id, int localId);

    /** M6: el turno bloqueado ({@code FOR UPDATE}) dentro de la transacción de la transferencia. */
    Optional<Turno> bloquearEnLocal(int id, int localId);

    /** M6: deja el turno TRANSFERIDO apuntando a su sucesor (y libera la ventanilla si estaba llamado). */
    void marcarTransferido(int id, int sucesorId, Instant ahora, boolean liberarVentanilla);

    /** Llama a {@code emitir_turno} (numeración diaria por cola, clave de prioridad y contexto para M2). */
    int emitir(int colaId, Integer clienteId, CanalTurno canal, String token, LocalDate fecha, Integer categoriaId, Instant emitidoAt, String origenJson);

    void marcarPrioridadVerificada(int id);

    /** RN05: turnos emitidos en el mes (las transferencias no cuentan). */
    int contarDesde(int localId, LocalDate desde);

    /** RN03: turno activo del cliente en la cola. */
    Optional<CodigoYToken> activoDeCliente(int colaId, int clienteId);

    int posicion(int turnoId);

    int tiempoEstimadoBase(int colaId, int posicion);

    int enEspera(int colaId, LocalDate fecha);

    /** Los primeros {@code limite} en espera de la cola, en el orden en que serán llamados. */
    List<Turno> primerosEnEspera(int colaId, LocalDate fecha, int limite);

    /** Todos los turnos del día del local con los datos que muestran el panel y la TV. */
    List<TurnoDelDia> delDia(int localId, LocalDate fecha);

    List<LlamadoEnCola> llamandoAhora(int colaId, LocalDate fecha);

    Optional<Turno> llamadoEnVentanilla(int ventanillaId);

    /** Elige el siguiente turno (prioridad, antigüedad y tope de adelantos) y lo bloquea dentro de la transacción. */
    Optional<Integer> siguiente(int localId, Integer colaId, LocalDate fecha);

    void marcarLlamado(int id, int ventanillaId, Instant ahora);

    /**
     * Cambia el estado solo si el turno sigue en {@code desde} (guarda optimista: si otro proceso lo cambió, por
     * ejemplo la expiración RN04, no se pisa). Ajusta las fechas y el contador de rellamadas según el destino.
     */
    boolean transicionar(int id, EstadoTurno desde, EstadoTurno hacia, Instant ahora);

    /** RN04: llamados que superaron el tiempo de presentación del local. */
    List<Turno> llamadosVencidos(int localId, Instant limite);

    /** Turnos que siguen en espera (EMITIDO o AVISADO) de días anteriores a {@code fecha} (fecha del local). */
    List<Turno> enEsperaAntesDe(int localId, LocalDate fecha);

    Optional<Sucesor> sucesor(int sucesorId);

    /** Historial del operador (N02): página de 50 por id descendente. */
    List<FilaHistorial> historial(int localId, LocalDate fecha, Integer ventanillaId, EstadoTurno estado, Integer cursor);

    /** Tiempos del día para los KPI del historial. */
    List<Turno> delDiaFiltrado(int localId, LocalDate fecha, Integer ventanillaId, EstadoTurno estado);

    record CodigoYToken(String codigo, String token) {
    }

    record TurnoDelDia(Turno turno, String clienteNombre, String ventanillaNombre, String categoriaNombre, String categoriaCodigo) {
    }

    record LlamadoEnCola(String codigo, String codigoProvisional, String ventanilla) {
    }

    record Sucesor(String token, String codigo, String cola) {
    }

    record FilaHistorial(int id, String codigo, String codigoProvisional, EstadoTurno estado, CanalTurno canal, Instant emitidoAt,
                                Instant llamadoAt, Instant finalizadoAt, int rellamadas, String cola, String ventanilla, String cliente) {
    }
}
