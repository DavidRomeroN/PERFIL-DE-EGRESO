package pe.turnoya.nucleo.eventos;

/** Cambió algo en las colas del local (para refrescar pantallas). {@code colaId} nulo = varias colas. */
public record ColaActualizada(int localId, Integer colaId) {
}
