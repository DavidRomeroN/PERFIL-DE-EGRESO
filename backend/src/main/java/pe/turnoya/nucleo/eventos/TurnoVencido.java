package pe.turnoya.nucleo.eventos;

/** RN04: el turno fue llamado y no se presentó a tiempo; pasó a NO_SE_PRESENTO automáticamente. */
public record TurnoVencido(int localId, int turnoId) {
}
