package pe.turnoya.notificaciones;

import java.util.List;
import org.springframework.stereotype.Service;
import pe.turnoya.notificaciones.envio.EnvioAvisos;

/**
 * Puerta de entrada para que los módulos opcionales (M2 aviso por minutos, M3 recordatorios de cita, M5 kiosco)
 * envíen un aviso al cliente con las mismas reglas que los del núcleo: queda en {@code notificacion}, respeta el plan
 * y el cupo mensual y, si no corresponde WhatsApp, se degrada a aviso web.
 */
@Service
public class AvisosAlCliente {

    private final EnvioAvisos envio;

    AvisosAlCliente(EnvioAvisos envio) {
        this.envio = envio;
    }

    /** @return canal usado: {@code WHATSAPP} o {@code WEB} */
    public String deTurno(int localId, int turnoId, String telefonoE164, String plantilla, List<String> parametros, String texto) {
        return envio.enviar(EnvioAvisos.Aviso.deTurno(localId, turnoId, telefonoE164, plantilla, parametros, texto));
    }

    /** @return canal usado: {@code WHATSAPP} o {@code WEB} */
    public String deCita(int localId, int citaId, String telefonoE164, String plantilla, List<String> parametros, String texto) {
        return envio.enviar(new EnvioAvisos.Aviso(localId, null, citaId, telefonoE164, plantilla, parametros, texto, true));
    }

    /** M7 · Aviso al celular del propio local (alertas escaladas). No consume el cupo de avisos a clientes. */
    public String alLocal(int localId, String telefonoE164, String plantilla, String texto) {
        return envio.enviar(new EnvioAvisos.Aviso(localId, null, null, telefonoE164, plantilla, List.of(), texto, false));
    }
}
