package pe.turnoya.nucleo;

import static org.assertj.core.api.Assertions.assertThat;
import static pe.turnoya.nucleo.EstadoTurno.ATENDIDO;
import static pe.turnoya.nucleo.EstadoTurno.AVISADO;
import static pe.turnoya.nucleo.EstadoTurno.CANCELADO;
import static pe.turnoya.nucleo.EstadoTurno.EMITIDO;
import static pe.turnoya.nucleo.EstadoTurno.LLAMADO;
import static pe.turnoya.nucleo.EstadoTurno.NO_SE_PRESENTO;
import static pe.turnoya.nucleo.EstadoTurno.TRANSFERIDO;

import java.util.EnumSet;
import org.junit.jupiter.api.Test;

/** Diagrama de estados del turno (sección 8.6): las mismas transiciones que legacy/. */
class EstadoTurnoTest {

    @Test
    void transicionesPermitidas() {
        assertThat(destinos(EMITIDO)).containsExactlyInAnyOrder(AVISADO, LLAMADO, CANCELADO, TRANSFERIDO);
        assertThat(destinos(AVISADO)).containsExactlyInAnyOrder(LLAMADO, CANCELADO, TRANSFERIDO);
        assertThat(destinos(LLAMADO)).containsExactlyInAnyOrder(LLAMADO, ATENDIDO, NO_SE_PRESENTO, TRANSFERIDO);
    }

    @Test
    void losEstadosFinalesNoCambian() {
        for (EstadoTurno fin : EnumSet.of(ATENDIDO, NO_SE_PRESENTO, CANCELADO, TRANSFERIDO)) {
            assertThat(destinos(fin)).as(fin.name()).isEmpty();
            assertThat(fin.finalizado()).isTrue();
        }
    }

    @Test
    void enEsperaYActivo() {
        assertThat(EMITIDO.enEspera()).isTrue();
        assertThat(AVISADO.enEspera()).isTrue();
        assertThat(LLAMADO.enEspera()).isFalse();
        assertThat(LLAMADO.activo()).isTrue();
    }

    private static EnumSet<EstadoTurno> destinos(EstadoTurno desde) {
        EnumSet<EstadoTurno> r = EnumSet.noneOf(EstadoTurno.class);
        for (EstadoTurno e : EstadoTurno.values()) {
            if (desde.puedePasarA(e)) {
                r.add(e);
            }
        }
        return r;
    }
}
