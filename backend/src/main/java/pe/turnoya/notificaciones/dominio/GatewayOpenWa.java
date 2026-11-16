package pe.turnoya.notificaciones.dominio;

/**
 * Puerto de salida: administración de las sesiones de WhatsApp en el gateway OpenWA. Cada negocio puede tener su
 * propia sesión (su número), vinculada con el QR o con un código de 8 caracteres pedido para su número.
 * Lo implementa {@code infraestructura.OpenWaHttp}.
 */
public interface GatewayOpenWa {

    /** Estado consolidado de la sesión {@code sesion}; nunca lanza: los errores de conexión vuelven en {@code error}. */
    Estado estado(String sesion);

    /** Crea la sesión si no existe y la arranca (pasa a {@code qr_ready} para vincular). */
    void iniciar(String sesion);

    /** {@code desvincular} cierra la sesión en el teléfono; si no, solo la detiene. */
    void detener(String sesion, boolean desvincular);

    /**
     * Código para vincular sin escanear (WhatsApp → Dispositivos vinculados → Vincular con número de teléfono). Arranca
     * la sesión si hace falta. {@code telefono} solo dígitos con código de país (51951234567).
     */
    String codigoVinculacion(String sesion, String telefono);

    record Estado(boolean configurado, String url, String sesion, boolean alcanzable, String estado, String telefono, String nombre,
                  String qr, String error, String numeroLocal, String codigo) {

        public Estado(boolean configurado, String url, String sesion, boolean alcanzable, String estado, String telefono, String nombre,
                      String qr, String error) {
            this(configurado, url, sesion, alcanzable, estado, telefono, nombre, qr, error, null, null);
        }

        public boolean conectado() {
            return "ready".equals(estado);
        }

        /** El número que el negocio registró para enviar sus avisos y, si se acaba de pedir, el código de vinculación. */
        public Estado delLocal(String numero, String codigoVinculacion) {
            return new Estado(configurado, url, sesion, alcanzable, estado, telefono, nombre, qr, error, numero, codigoVinculacion);
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
