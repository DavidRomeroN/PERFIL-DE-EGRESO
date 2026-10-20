package pe.turnoya.nucleo.dominio;

/** Ventanilla o módulo de atención. Sin cola asignada ({@code colaId} nulo) atiende todas las colas. */
public record Ventanilla(int id, int localId, String nombre, Integer colaId, boolean activa) {
}
