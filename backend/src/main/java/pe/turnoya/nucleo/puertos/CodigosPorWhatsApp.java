package pe.turnoya.nucleo.puertos;

/** Envío del código de verificación del celular de la app móvil. Lo implementa notificaciones. */
public interface CodigosPorWhatsApp {

    /**
     * El código viaja solo en el mensaje: en el registro de avisos del local no queda.
     *
     * @return {@code true} si salió por WhatsApp; {@code false} si el local no puede enviarlo (plan sin WhatsApp o fallo)
     */
    boolean enviar(int localId, String telefonoE164, String codigo);
}
