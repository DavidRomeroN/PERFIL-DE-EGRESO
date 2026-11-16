package pe.turnoya.notificaciones.envio;

import org.springframework.stereotype.Component;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.notificaciones.dominio.RepositorioNotificaciones;

/**
 * Sesión de OpenWA desde la que salen los avisos de cada negocio: la suya ({@code <sesión>-local-<id>}) si registró
 * su número, o la sesión general de la plataforma.
 */
@Component
public class SesionesWhatsApp {

    private final RepositorioNotificaciones notificaciones;
    private final String general;

    SesionesWhatsApp(RepositorioNotificaciones notificaciones, PropiedadesTurnoYa propiedades) {
        this.notificaciones = notificaciones;
        this.general = propiedades.whatsapp().openwaSession();
    }

    public String de(int localId) {
        return notificaciones.numeroWhatsApp(localId).isPresent() ? propia(localId) : general;
    }

    public String propia(int localId) {
        return general + "-local-" + localId;
    }
}
