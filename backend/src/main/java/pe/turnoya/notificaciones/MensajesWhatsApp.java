package pe.turnoya.notificaciones;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import pe.turnoya.notificaciones.dominio.ProveedorWhatsApp;

/**
 * Respuestas de texto libre a un chat de WhatsApp que abrió el cliente (las usa el bot). A diferencia de los avisos
 * del turno, no consumen el cupo mensual del plan ni quedan en {@code notificacion}: son la conversación misma.
 */
@Service
public class MensajesWhatsApp {

    private static final Logger log = LoggerFactory.getLogger(MensajesWhatsApp.class);

    private final ProveedorWhatsApp proveedor;

    MensajesWhatsApp(ProveedorWhatsApp proveedor) {
        this.proveedor = proveedor;
    }

    /** @return id del mensaje en el proveedor, o {@code null} si no se pudo enviar */
    public String responder(String telefonoE164, String texto) {
        ProveedorWhatsApp.Resultado r = proveedor.enviar(telefonoE164, null, List.of(), texto);
        if (!r.ok()) {
            log.warn("Respuesta del bot no enviada: {}", r.error());
            return null;
        }
        if (simulado()) {
            log.info("WhatsApp simulado → {}:\n{}", telefonoE164, texto);
        }
        return r.proveedorMsgId();
    }

    /** Con el simulador no sale nada real: el webhook devuelve las respuestas para poder probar el bot. */
    public boolean simulado() {
        return "mock".equals(proveedor.nombre());
    }
}
