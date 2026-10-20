package pe.turnoya.tiemporeal;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.datos.DespuesDelCommit;
import pe.turnoya.notificaciones.NotificacionRegistrada;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.nucleo.eventos.TurnoCambioEstado;
import pe.turnoya.nucleo.eventos.TurnoLlamado;
import pe.turnoya.tiemporeal.bus.BusTiempoReal;
import pe.turnoya.tiemporeal.bus.EventoTiempoReal;

/**
 * Traduce los eventos de dominio al formato de las pantallas y los publica después del commit. No pasa por el
 * registro de eventos (outbox): si una pantalla pierde un aviso, el siguiente refresco la pone al día.
 */
@Component
class TraductorEventos {

    private final BusTiempoReal bus;

    TraductorEventos(BusTiempoReal bus) {
        this.bus = bus;
    }

    @EventListener
    void en(ColaActualizada e) {
        Map<String, Object> campos = new LinkedHashMap<>();
        if (e.colaId() != null) {
            campos.put("colaId", e.colaId());
        }
        publicar(new EventoTiempoReal("cola:actualizada", e.localId(), campos));
    }

    @EventListener
    void en(TurnoLlamado e) {
        Map<String, Object> turno = new LinkedHashMap<>();
        turno.put("id", e.turnoId());
        turno.put("codigo", e.codigo());
        turno.put("token", e.token());
        turno.put("ventanilla", e.ventanilla());
        turno.put("cola", e.cola());
        turno.put("rellamada", e.rellamada());
        turno.put("codigoProvisional", e.codigoProvisional());
        publicar(new EventoTiempoReal("turno:llamado", e.localId(), Map.of("turno", turno)));
    }

    @EventListener
    void en(TurnoCambioEstado e) {
        Map<String, Object> turno = new LinkedHashMap<>();
        turno.put("id", e.turnoId());
        turno.put("token", e.token());
        turno.put("estado", e.estado().name());
        publicar(new EventoTiempoReal("turno:estado", e.localId(), Map.of("turno", turno)));
    }

    @EventListener
    void en(NotificacionRegistrada e) {
        Map<String, Object> n = new LinkedHashMap<>();
        n.put("id", e.notificacionId());
        n.put("turnoId", e.turnoId());
        n.put("mensaje", e.mensaje());
        n.put("destino", e.destino());
        publicar(new EventoTiempoReal("notificacion:nueva", e.localId(), Map.of("notificacion", n)));
    }

    private void publicar(EventoTiempoReal evento) {
        DespuesDelCommit.ejecutar(() -> bus.publicar(evento));
    }
}
