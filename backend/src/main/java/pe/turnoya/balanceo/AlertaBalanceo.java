package pe.turnoya.balanceo;

/**
 * M6 pide una alerta al admin: una regla con acción {@code NOTIFICAR} ({@code tipo = COLA_LARGA}) o el tope de acciones
 * automáticas por hora ({@code tipo = BALANCEO_LIMITE}). La escucha Analítica (M7) para registrarla en sus alertas.
 */
public record AlertaBalanceo(int localId, String tipo, String clave, String mensaje, Integer reglaId) {
}
