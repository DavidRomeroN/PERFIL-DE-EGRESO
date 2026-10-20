package pe.turnoya.nucleo.eventos;

/** RF03: al turno le faltan {@code faltan} personas (o menos) para ser llamado; hay que avisarle. */
public record TurnoAvisado(int localId, int turnoId, int faltan) {
}
