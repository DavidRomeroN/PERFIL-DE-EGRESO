package pe.turnoya.nucleo.dominio;

/**
 * Ventanilla o módulo de atención. Cada cola tiene una sola ventanilla activa y cada ventanilla atiende una sola cola;
 * {@code colaId} nulo solo queda en ventanillas antiguas desactivadas.
 */
public record Ventanilla(int id, int localId, String nombre, Integer colaId, boolean activa) {
}
