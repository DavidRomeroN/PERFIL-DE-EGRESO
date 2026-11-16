package pe.turnoya.nucleo.dominio;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import pe.turnoya.nucleo.CanalTurno;
import pe.turnoya.nucleo.EstadoTurno;

/** Puerto de salida de los reportes: los turnos de un rango de fechas con su cola y ventanilla. */
public interface RepositorioReportes {

    /** Turnos del local entre dos fechas (incluidas), sin los transferidos, ordenados por emisión. */
    List<FilaReporte> turnosDelRango(int localId, LocalDate desde, LocalDate hasta);

    record FilaReporte(int id, LocalDate fecha, String codigo, int colaId, String cola, String prefijo, EstadoTurno estado,
                       CanalTurno canal, String ventanilla, Instant emitidoAt, Instant llamadoAt, Instant finalizadoAt) {
    }
}
