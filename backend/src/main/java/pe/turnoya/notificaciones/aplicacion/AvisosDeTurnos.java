package pe.turnoya.notificaciones.aplicacion;

import java.util.List;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.notificaciones.dominio.Plantillas;
import pe.turnoya.nucleo.ContactoTurnos;
import pe.turnoya.nucleo.eventos.TurnoAvisado;
import pe.turnoya.nucleo.eventos.TurnoLlamado;
import pe.turnoya.nucleo.eventos.TurnoVencido;

/**
 * Reacciona a los eventos del núcleo y envía el aviso correspondiente. Cada oyente corre después del commit, en
 * segundo plano, y queda en el registro de eventos hasta completarse: si el proceso se cae, se reintenta. Sin
 * transacción propia ({@code NOT_SUPPORTED}): la llamada al proveedor de WhatsApp no retiene una conexión a la BD.
 */
@Component
class AvisosDeTurnos {

    private final ContactoTurnos contactos;
    private final EnvioAvisos envio;
    private final PropiedadesTurnoYa propiedades;

    AvisosDeTurnos(ContactoTurnos contactos, EnvioAvisos envio, PropiedadesTurnoYa propiedades) {
        this.contactos = contactos;
        this.envio = envio;
        this.propiedades = propiedades;
    }

    /** RF03: "faltan N personas". Sin celular el aviso igual queda en la web de seguimiento. */
    @ApplicationModuleListener(propagation = Propagation.NOT_SUPPORTED)
    void alAvisar(TurnoAvisado evento) {
        contactos.de(evento.turnoId()).ifPresent(c -> envio.enviar(EnvioAvisos.Aviso.deTurno(c.localId(), c.turnoId(), c.telefonoE164(),
                Plantillas.TURNO_PROXIMO, List.of(c.codigo(), c.localNombre()),
                Plantillas.turnoProximo(c.nombre(), c.codigo(), c.localNombre(), evento.faltan(), propiedades.urlPublica() + "/t/" + c.token()))));
    }

    /** Llamado por la ventanilla (no en rellamadas). Solo si dejó celular. */
    @ApplicationModuleListener(propagation = Propagation.NOT_SUPPORTED)
    void alLlamar(TurnoLlamado evento) {
        if (evento.rellamada()) {
            return;
        }
        contactos.de(evento.turnoId()).filter(c -> c.telefonoE164() != null)
                .ifPresent(c -> envio.enviar(EnvioAvisos.Aviso.deTurno(c.localId(), c.turnoId(), c.telefonoE164(),
                        Plantillas.TURNO_LLAMADO, List.of(c.codigo(), evento.ventanilla()),
                        Plantillas.turnoLlamado(c.codigo(), evento.ventanilla(), c.localNombre()))));
    }

    /** RN04: el turno venció por no presentarse. Solo si dejó celular. */
    @ApplicationModuleListener(propagation = Propagation.NOT_SUPPORTED)
    void alVencer(TurnoVencido evento) {
        contactos.de(evento.turnoId()).filter(c -> c.telefonoE164() != null)
                .ifPresent(c -> envio.enviar(EnvioAvisos.Aviso.deTurno(c.localId(), c.turnoId(), c.telefonoE164(),
                        Plantillas.TURNO_VENCIDO, List.of(), Plantillas.turnoVencido(c.codigo(), c.localNombre()))));
    }
}
