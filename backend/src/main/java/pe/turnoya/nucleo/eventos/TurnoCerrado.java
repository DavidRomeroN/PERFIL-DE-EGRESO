package pe.turnoya.nucleo.eventos;

import pe.turnoya.nucleo.EstadoTurno;

/**
 * El turno terminó (ATENDIDO, NO_SE_PRESENTO o CANCELADO). M3 actualiza la cita asociada y M2 aprende del tiempo
 * de servicio: cada uno escucha este evento en su módulo.
 */
public record TurnoCerrado(int localId, int turnoId, Integer citaId, EstadoTurno estado) {
}
