package pe.turnoya.notificaciones.dominio;

/**
 * Puerto de salida: administración de la sesión de WhatsApp en el gateway OpenWA (número propio vinculado con QR).
 * Lo implementa {@code infraestructura.OpenWaHttp}.
 */
public interface GatewayOpenWa {

    /** Estado consolidado para el panel; nunca lanza: los errores de conexión vuelven en {@code error}. */
    Estado estado();

    /** Crea la sesión si no existe y la arranca (pasa a {@code qr_ready} para escanear). */
    void iniciar();

    /** {@code desvincular} cierra la sesión en el teléfono; si no, solo la detiene. */
    void detener(boolean desvincular);

    record Estado(boolean configurado, String url, String sesion, boolean alcanzable, String estado, String telefono, String nombre,
                  String qr, String error) {

        public boolean conectado() {
            return "ready".equals(estado);
        }
    }

    /** Error del gateway con el código HTTP que conviene devolver. */
    final class ErrorOpenWa extends RuntimeException {
        private final int status;

        public ErrorOpenWa(String mensaje, int status) {
            super(mensaje);
            this.status = status;
        }

        public int status() {
            return status;
        }
    }
}
