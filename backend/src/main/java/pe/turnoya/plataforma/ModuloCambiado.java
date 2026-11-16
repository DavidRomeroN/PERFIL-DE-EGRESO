package pe.turnoya.plataforma;

/**
 * Evento: el admin encendió o apagó un módulo del local. Los módulos que necesitan datos iniciales (por ejemplo
 * las categorías de prioridad de M1 y M3) lo escuchan; la plataforma no los conoce.
 */
public record ModuloCambiado(int localId, Modulo modulo, boolean habilitado) {
}
