package pe.turnoya.notificaciones.dominio;

import java.util.List;

/**
 * Proveedor de WhatsApp (patrón estrategia, ADR-04). Se elige con {@code WHATSAPP_PROVIDER}:
 * {@code mock} (simulador), {@code openwa} (gateway propio) o {@code meta} (WhatsApp Cloud API).
 */
public interface ProveedorWhatsApp {

    String nombre();

    Resultado enviar(String telefonoE164, String plantilla, List<String> parametros, String textoRenderizado);

    /** Envía desde la sesión (número) de un negocio; los proveedores sin sesiones propias la ignoran. */
    default Resultado enviarDesde(String sesion, String telefonoE164, String plantilla, List<String> parametros, String textoRenderizado) {
        return enviar(telefonoE164, plantilla, parametros, textoRenderizado);
    }

    record Resultado(boolean ok, String proveedorMsgId, String error) {

        public static Resultado exito(String id) {
            return new Resultado(true, id, null);
        }

        public static Resultado fallo(String error) {
            return new Resultado(false, null, error);
        }
    }
}
