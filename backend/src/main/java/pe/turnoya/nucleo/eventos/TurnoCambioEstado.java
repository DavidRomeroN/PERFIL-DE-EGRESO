package pe.turnoya.nucleo.eventos;

import pe.turnoya.nucleo.EstadoTurno;

/** Un turno pasó a otro estado. */
public record TurnoCambioEstado(int localId, int turnoId, String token, EstadoTurno estado) {
}
