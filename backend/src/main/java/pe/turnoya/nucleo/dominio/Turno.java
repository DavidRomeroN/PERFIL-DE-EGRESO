package pe.turnoya.nucleo.dominio;

import java.time.Instant;
import java.time.LocalDate;
import pe.turnoya.nucleo.CanalTurno;
import pe.turnoya.nucleo.EstadoTurno;

/** Fila de la tabla {@code turno}. */
public record Turno(
        int id,
        int localId,
        int colaId,
        int numero,
        String codigo,
        String token,
        Integer clienteId,
        EstadoTurno estado,
        Integer ventanillaId,
        CanalTurno canal,
        int rellamadas,
        Instant emitidoAt,
        Instant avisadoAt,
        Instant llamadoAt,
        Instant atendidoAt,
        Instant finalizadoAt,
        LocalDate fecha,
        Integer categoriaId,
        Boolean prioridadVerificada,
        Integer citaId,
        String codigoProvisional,
        Integer sucesorId,
        Integer avisoMinAntes) {
}
