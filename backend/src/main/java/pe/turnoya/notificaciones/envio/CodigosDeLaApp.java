package pe.turnoya.notificaciones.envio;

import org.springframework.stereotype.Component;
import pe.turnoya.nucleo.puertos.CodigosPorWhatsApp;

/** Adaptador del puerto del núcleo: el código de la app móvil sale por el mismo proveedor de WhatsApp que los avisos. */
@Component
class CodigosDeLaApp implements CodigosPorWhatsApp {

    private final EnvioAvisos envio;

    CodigosDeLaApp(EnvioAvisos envio) {
        this.envio = envio;
    }

    @Override
    public boolean enviar(int localId, String telefonoE164, String codigo) {
        return envio.enviarCodigo(localId, telefonoE164, codigo);
    }
}
