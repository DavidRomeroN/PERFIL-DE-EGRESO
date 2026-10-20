package pe.turnoya.notificaciones;

/**
 * Se registró o cambió de estado un aviso de un turno. {@code mensaje} y {@code destino} son datos personales:
 * el canal público de tiempo real los omite.
 */
public record NotificacionRegistrada(int localId, int turnoId, int notificacionId, String mensaje, String destino) {
}
