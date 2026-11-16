package pe.turnoya.plataforma;

/**
 * Evento síncrono (misma transacción): se dio de alta un local. El núcleo crea su cola "Atención general" y la
 * "Ventanilla 1"; otros módulos pueden sembrar sus datos iniciales. {@code conVentanilla} es falso en el registro
 * público, que solo crea la cola (como el sistema anterior).
 */
public record LocalCreado(int localId, boolean conVentanilla) {
}
