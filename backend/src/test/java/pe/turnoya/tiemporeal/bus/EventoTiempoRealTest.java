package pe.turnoya.tiemporeal.bus;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

/** El canal público no expone datos personales ni tokens de seguimiento. */
class EventoTiempoRealTest {

    @Test
    void alPublicoNoLeLlegaElTokenDelTurno() {
        var evento = new EventoTiempoReal("turno:estado", 1, Map.of("turno", Map.of("id", 5, "token", "ABCDEFGHJK", "estado", "AVISADO")));
        @SuppressWarnings("unchecked")
        Map<String, Object> turno = (Map<String, Object>) evento.paraPublico().campos().get("turno");
        assertThat(turno).containsEntry("id", 5).containsEntry("estado", "AVISADO").doesNotContainKey("token");
        assertThat(evento.comoJson()).containsEntry("tipo", "turno:estado").containsEntry("localId", 1);
    }

    @Test
    void alPublicoNoLeLlegaElTextoDelAviso() {
        var evento = new EventoTiempoReal("notificacion:nueva", 1,
                Map.of("notificacion", Map.of("id", 9, "turnoId", 5, "mensaje", "Hola María", "destino", "+51 9** *** 567")));
        @SuppressWarnings("unchecked")
        Map<String, Object> n = (Map<String, Object>) evento.paraPublico().campos().get("notificacion");
        assertThat(n).containsEntry("mensaje", "").containsEntry("turnoId", 5);
        assertThat(n.get("destino")).isNull();
    }

    @Test
    void losEventosInternosNoSalenAlPublico() {
        assertThat(new EventoTiempoReal("alerta:nueva", 1, Map.of()).paraPublico()).isNull();
    }
}
