package pe.turnoya.tiemporeal.bus;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Evento tal como viaja al navegador: {@code event: <tipo>} y como datos {@code {tipo, localId, ...campos}}.
 */
public record EventoTiempoReal(String tipo, int localId, Map<String, Object> campos) {

    /** Eventos que puede recibir cualquiera (TV, "mi turno"): sin datos personales ni internos. */
    private static final Set<String> PUBLICOS = Set.of("cola:actualizada", "turno:llamado", "turno:estado", "notificacion:nueva");

    public Map<String, Object> comoJson() {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("tipo", tipo);
        json.put("localId", localId);
        json.putAll(campos);
        return json;
    }

    /**
     * Versión para el público: solo eventos públicos; sin el texto ni el destino de los avisos (llevan el nombre del
     * cliente) y sin el token de seguimiento de los turnos (con él se podía cancelar el turno de otra persona).
     */
    public EventoTiempoReal paraPublico() {
        if (!PUBLICOS.contains(tipo)) {
            return null;
        }
        Map<String, Object> copia = new LinkedHashMap<>(campos);
        if (copia.get("turno") instanceof Map<?, ?> turno) {
            Map<Object, Object> sinToken = new LinkedHashMap<>(turno);
            sinToken.remove("token");
            copia.put("turno", sinToken);
        }
        if (copia.get("notificacion") instanceof Map<?, ?> n) {
            Map<String, Object> resumen = new LinkedHashMap<>();
            resumen.put("id", n.get("id"));
            resumen.put("turnoId", n.get("turnoId"));
            resumen.put("mensaje", "");
            resumen.put("destino", null);
            copia.put("notificacion", resumen);
        }
        return new EventoTiempoReal(tipo, localId, copia);
    }
}
