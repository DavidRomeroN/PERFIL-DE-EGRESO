package pe.turnoya.plataforma;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import pe.turnoya.compartido.tiempo.Fechas;

/** N05: horario de atención en la hora local (Lima = UTC−5), con la próxima apertura. */
class HorarioAtencionTest {

    private static final Local LOCAL = new Local(1, "demo", "Demo SAC", "Demo", "Salud", null, "Juliaca", null, 1, Fechas.LIMA,
            true, "#0f766e", null, null, null, 2, 180, null);

    /** Lunes a viernes 08:00–17:00. */
    private static final List<HorarioAtencion.Horario> SEMANA = List.of(1, 2, 3, 4, 5).stream()
            .map(d -> new HorarioAtencion.Horario(d, "08:00", "17:00")).toList();

    @Test
    void sinHorariosEstaSiempreAbierto() {
        assertThat(HorarioAtencion.calcular(List.of(), LOCAL, Instant.parse("2026-10-18T05:00:00Z")).abierto()).isTrue();
    }

    @Test
    void abiertoDentroDelHorarioLocal() {
        // Lunes 19/10/2026 10:00 en Lima = 15:00 UTC
        assertThat(HorarioAtencion.calcular(SEMANA, LOCAL, Instant.parse("2026-10-19T15:00:00Z")).abierto()).isTrue();
    }

    @Test
    void cerradoAntesDeAbrirIndicaHoy() {
        // Lunes 07:00 en Lima
        var estado = HorarioAtencion.calcular(SEMANA, LOCAL, Instant.parse("2026-10-19T12:00:00Z"));
        assertThat(estado.abierto()).isFalse();
        assertThat(estado.mensaje()).isEqualTo("Estamos cerrados. Abrimos hoy a las 08:00.");
        assertThat(estado.proximaApertura()).isEqualTo(Instant.parse("2026-10-19T13:00:00Z"));
    }

    @Test
    void cerradoElSabadoAbreElLunes() {
        // Sábado 17/10/2026 12:00 en Lima
        var estado = HorarioAtencion.calcular(SEMANA, LOCAL, Instant.parse("2026-10-17T17:00:00Z"));
        assertThat(estado.abierto()).isFalse();
        assertThat(estado.mensaje()).isEqualTo("Estamos cerrados. Abrimos el lunes a las 08:00.");
    }

    @Test
    void elViernesEnLaNocheAbreElLunes() {
        // Viernes 16/10/2026 20:00 en Lima = sábado 01:00 UTC: la fecha que cuenta es la de Lima
        var estado = HorarioAtencion.calcular(SEMANA, LOCAL, Instant.parse("2026-10-17T01:00:00Z"));
        assertThat(estado.mensaje()).isEqualTo("Estamos cerrados. Abrimos el lunes a las 08:00.");
    }
}
