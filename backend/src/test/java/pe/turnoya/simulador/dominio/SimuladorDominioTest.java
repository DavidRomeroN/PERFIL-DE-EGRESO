package pe.turnoya.simulador.dominio;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;
import pe.turnoya.simulador.dominio.ParametrosSimulacion.Costos;
import pe.turnoya.simulador.dominio.ParametrosSimulacion.Servicio;
import pe.turnoya.simulador.dominio.ParametrosSimulacion.TipoServicio;
import pe.turnoya.simulador.dominio.ParametrosSimulacion.Tramo;
import pe.turnoya.simulador.dominio.ParametrosSimulacion.TramoVentanillas;

/** Erlang C con valores conocidos y la simulación de eventos discretos (reproducible con la misma semilla). */
class SimuladorDominioTest {

    @Test
    void erlangCConValoresDeLibro() {
        // c=1, a=0,5 ⇒ P(esperar) = ρ = 0,5
        var uno = ErlangC.calcular(30, 1, 1);
        assertThat(uno.estable()).isTrue();
        assertThat(uno.probabilidadEspera()).isCloseTo(0.5, within(1e-9));
        assertThat(uno.esperaMin()).isCloseTo(1.0, within(1e-9));

        // c=2, a=1 ⇒ C = 1/3 y Wq = C / (cμ − λ) = 1/3 min
        var dos = ErlangC.calcular(60, 1, 2);
        assertThat(dos.probabilidadEspera()).isCloseTo(1.0 / 3, within(1e-9));
        assertThat(dos.esperaMin()).isCloseTo(1.0 / 3, within(1e-9));
        assertThat(dos.ocupacion()).isCloseTo(0.5, within(1e-9));
    }

    @Test
    void inestableCuandoLlegaMasDeLoQueSeAtiende() {
        var r = ErlangC.calcular(60, 3, 3); // a = 3 = c
        assertThat(r.estable()).isFalse();
        assertThat(r.esperaMin()).isNull();
        assertThat(ErlangC.percentilEspera(60, 3, 3, 0.9)).isInfinite();
    }

    @Test
    void elMinimoCumpleElObjetivoYUnoMenosNo() {
        int c = ErlangC.minimoServidores(30, 5, 15, 0.9, 0.85, 200);
        assertThat(ErlangC.nivelServicio(30, 5, c, 15)).isGreaterThanOrEqualTo(0.9);
        assertThat(ErlangC.calcular(30, 5, c).ocupacion()).isLessThanOrEqualTo(0.85);
        boolean anteriorCumple = c > 1 && ErlangC.calcular(30, 5, c - 1).estable()
                && ErlangC.nivelServicio(30, 5, c - 1, 15) >= 0.9 && ErlangC.calcular(30, 5, c - 1).ocupacion() <= 0.85;
        assertThat(anteriorCumple).isFalse();
        // Más ventanillas nunca empeoran el nivel de servicio
        var tabla = ErlangC.tabla(30, 5, 15, 3, 8);
        for (int i = 1; i < tabla.size(); i++) {
            assertThat(tabla.get(i).nivelServicio()).isGreaterThanOrEqualTo(tabla.get(i - 1).nivelServicio());
        }
    }

    private static ParametrosSimulacion dia(int ventanillas, int replicas, int semilla) {
        return new ParametrosSimulacion("08:00", "12:00", List.of(new Tramo("08:00", 30)),
                new Servicio(TipoServicio.LOGNORMAL, 5, 0.6, List.of()), List.of(new TramoVentanillas("08:00", ventanillas)), 30.0,
                new ParametrosSimulacion.NoShow(0.08, 3), 15, 90, new Costos(12.5, 0.4), replicas, semilla);
    }

    @Test
    void mismaSemillaMismoResultado() {
        var a = SimulacionEventos.monteCarlo(dia(3, 50, 2026));
        var b = SimulacionEventos.monteCarlo(dia(3, 50, 2026));
        assertThat(a.esperaMedia().media()).isEqualTo(b.esperaMedia().media());
        assertThat(a.pctSla().media()).isEqualTo(b.pctSla().media());
        assertThat(a.histograma()).isEqualTo(b.histograma());
        var otra = SimulacionEventos.monteCarlo(dia(3, 50, 7));
        assertThat(otra.esperaMedia().media()).isNotEqualTo(a.esperaMedia().media());
    }

    @Test
    void masVentanillasMenosEspera() {
        var pocas = SimulacionEventos.monteCarlo(dia(2, 100, 1));
        var muchas = SimulacionEventos.monteCarlo(dia(5, 100, 1));
        assertThat(muchas.esperaMedia().media()).isLessThan(pocas.esperaMedia().media());
        assertThat(muchas.pctSla().media()).isGreaterThan(pocas.pctSla().media());
        assertThat(muchas.pctSla().icInferior()).isLessThanOrEqualTo(muchas.pctSla().media());
        assertThat(muchas.pctSla().media()).isBetween(0.0, 1.0);
    }

    @Test
    void ajusteLogNormalRecuperaMediaYCv() {
        var ajuste = SimulacionEventos.ajustarLogNormal(List.of(4.0, 5.0, 6.0, 5.0, 4.5, 5.5));
        assertThat(ajuste.media()).isCloseTo(5.0, within(0.2));
        assertThat(ajuste.cv()).isBetween(0.05, 0.3);
    }
}
