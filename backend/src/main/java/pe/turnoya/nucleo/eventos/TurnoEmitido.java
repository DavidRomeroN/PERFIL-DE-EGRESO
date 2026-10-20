package pe.turnoya.nucleo.eventos;

/** Se emitió un turno (M2 registra la predicción mostrada). */
public record TurnoEmitido(int localId, int turnoId, int colaId, String canal) {
}
