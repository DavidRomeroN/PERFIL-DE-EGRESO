package pe.turnoya.transferencias.dominio;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Puerto de salida de M6: la tabla {@code transferencia} y las lecturas de turnos y colas que necesita. */
public interface RepositorioTransferencias {

    record Transferible(int id, String codigo, int colaId, String cola, String estado, boolean enEstaVentanilla) {
    }

    /** Turnos del día que se pueden transferir: el llamado en la ventanilla (primero) y los que esperan, en orden de llamada. */
    List<Transferible> transferibles(int localId, LocalDate fecha, Integer ventanillaId, int limite);

    /** Colas activas del local (id → nombre). */
    Map<Integer, String> colas(int localId);

    boolean ventanillaActiva(int id, int localId);

    record NuevaTransferencia(int localId, int turnoOrigenId, int turnoDestinoId, int deColaId, int aColaId, Integer aVentanillaId, String motivo,
                              String detalle, Integer usuarioId) {
    }

    record Transferencia(int id, int turnoOrigenId, int turnoDestinoId, String codigoOrigen, String codigoDestino, String deCola, String aCola,
                         String motivo, String detalle, String origen, Integer usuarioId, String usuario, Instant createdAt) {
    }

    void registrarTransferencia(NuevaTransferencia t);

    List<Transferencia> transferencias(int localId, Instant desde, Instant hasta, Integer cursor, int limite);
}
