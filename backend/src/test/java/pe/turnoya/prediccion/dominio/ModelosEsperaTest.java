package pe.turnoya.prediccion.dominio;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.function.DoubleSupplier;
import org.junit.jupiter.api.Test;
import pe.turnoya.compartido.estadistica.Estadistica;
import pe.turnoya.prediccion.dominio.ModelosEspera.MuestraTurno;
import pe.turnoya.prediccion.dominio.ModelosEspera.Tipo;

/** Mismos casos que las pruebas de {@code prediccion} del sistema anterior. */
class ModelosEsperaTest {

    @Test
    void cuantilesTipo7() {
        assertThat(Estadistica.cuantil(List.of(1, 2, 3, 4, 5), 0.1)).isCloseTo(1.4, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(Estadistica.cuantil(List.of(1, 2, 3, 4, 5), 0.9)).isCloseTo(4.6, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(Estadistica.cuantil(List.of(1, 2, 3, 4), 0.5)).isEqualTo(2.5);
    }

    @Test
    void winsorizacionAlP99() {
        List<Double> xs = new ArrayList<>(Collections.nCopies(99, 10.0));
        xs.add(10000.0);
        assertThat(Estadistica.winsorizar(xs, 0.99).stream().mapToDouble(Double::doubleValue).max().orElseThrow()).isLessThan(10000);
    }

    @Test
    void emaExacta() {
        var e = ModelosEspera.estadoInicial(Tipo.EMA, 300, 0.2);
        ModelosEspera.actualizarServicio(e, 200, 1, 20);
        ModelosEspera.actualizarServicio(e, 400, 1, 20);
        assertThat(e.sbar).isEqualTo(0.2 * 400 + 0.8 * 200);
        assertThat(ModelosEspera.predecir(e, 2, 1, 1, 20)).isEqualTo(3 * e.sbar);
    }

    @Test
    void contraccionSinDatosEnLaCeldaUsaLaMedianaDeLaCola() {
        var e = ModelosEspera.estadoInicial(Tipo.ESTACIONAL, 300, 0.2);
        for (int i = 0; i < 20; i++) {
            ModelosEspera.actualizarServicio(e, 100, 2, 20);
        }
        assertThat(ModelosEspera.servicioCelda(e, 5, 30)).isEqualTo(100);
    }

    @Test
    void cCeroEsUnoYKCeroPrediceUnServicio() {
        var e = ModelosEspera.estadoInicial(Tipo.EMA, 300, 0.2);
        assertThat(ModelosEspera.predecir(e, 0, 0, 1, 10)).isEqualTo(300);
    }

    @Test
    void monotonia() {
        var e = ModelosEspera.estadoInicial(Tipo.EMA, 300, 0.2);
        assertThat(ModelosEspera.predecir(e, 5, 2, 1, 10)).isGreaterThanOrEqualTo(ModelosEspera.predecir(e, 4, 2, 1, 10));
        assertThat(ModelosEspera.predecir(e, 5, 3, 1, 10)).isLessThanOrEqualTo(ModelosEspera.predecir(e, 5, 2, 1, 10));
    }

    @Test
    void intervaloContieneLaPrediccion() {
        var r = ModelosEspera.intervalo(ModelosEspera.estadoInicial(Tipo.BASELINE, 300, 0.2), 600, 20);
        assertThat(r.lo()).isLessThanOrEqualTo(600);
        assertThat(r.hi()).isGreaterThanOrEqualTo(600);
    }

    @Test
    void elegibilidadEnFrio() {
        assertThat(ModelosEspera.elegibles(20, 30)).containsExactly(Tipo.BASELINE);
        assertThat(ModelosEspera.elegibles(100, 30)).containsExactly(Tipo.BASELINE, Tipo.EMA);
        assertThat(ModelosEspera.elegibles(500, 30)).containsExactly(Tipo.BASELINE, Tipo.EMA, Tipo.ESTACIONAL);
    }

    @Test
    void histeresisDel5PorCiento() {
        var permitidos = List.of(Tipo.BASELINE, Tipo.EMA);
        assertThat(ModelosEspera.elegirModelo(Map.of(Tipo.BASELINE, 100.0, Tipo.EMA, 97.0), Tipo.BASELINE, permitidos)).isEqualTo(Tipo.BASELINE);
        assertThat(ModelosEspera.elegirModelo(Map.of(Tipo.BASELINE, 100.0, Tipo.EMA, 90.0), Tipo.BASELINE, permitidos)).isEqualTo(Tipo.EMA);
    }

    @Test
    void deriva() {
        assertThat(ModelosEspera.hayDeriva(180, 120, 50)).isTrue();
        assertThat(ModelosEspera.hayDeriva(150, 120, 50)).isFalse();
    }

    /** Una ventanilla FIFO, llegadas Poisson y servicio log-normal con media por franja conocida. */
    private static List<MuestraTurno> sintetico(int dias, int semilla) {
        DoubleSupplier rng = Estadistica.mulberry32(semilla);
        List<MuestraTurno> out = new ArrayList<>();
        int id = 1;
        long base = java.time.Instant.parse("2026-08-01T13:00:00Z").toEpochMilli();
        for (int d = 0; d < dias; d++) {
            double t = base + d * 86_400_000L;
            double libre = t;
            double fin = t + 8 * 3_600_000;
            List<Double> enCola = new ArrayList<>();
            while (t < fin) {
                t += -Math.log(1 - rng.getAsDouble()) * 6 * 60000;
                int franja = 16 + (int) Math.floor((t - (base + d * 86_400_000L)) / 1_800_000);
                double mediaSrv = franja < 22 ? 4 : 7;
                double srv = Math.exp(Math.log(mediaSrv * 60) + 0.3 * (rng.getAsDouble() - 0.5)) * 1000;
                final double ahora = t;
                int delante = (int) enCola.stream().filter(x -> x > ahora).count();
                double inicio = Math.max(t, libre);
                libre = inicio + srv;
                enCola.add(inicio);
                out.add(new MuestraTurno(id++, (long) t, (long) inicio, (long) libre, true, delante, 1, (d + 6) % 7, franja));
            }
        }
        return out;
    }

    @Test
    void sinFugaDeDatos() {
        var m = sintetico(10, 7);
        long corte = m.get(m.size() / 2).emitidoMs();
        var a = ModelosEspera.replay(m, ModelosEspera.estadoInicial(Tipo.ESTACIONAL, 300, 0.2)).pares().stream()
                .filter(p -> p.tMs() < corte - 3_600_000).map(ModelosEspera.Par::pred).toList();
        var alterado = m.stream().map(x -> x.emitidoMs() >= corte
                ? new MuestraTurno(x.id(), x.emitidoMs(), x.llamadoMs(), x.finalizadoMs() + 3_600_000, x.atendido(), x.delante(), x.c(), x.dow(), x.franja())
                : x).toList();
        var b = ModelosEspera.replay(alterado, ModelosEspera.estadoInicial(Tipo.ESTACIONAL, 300, 0.2)).pares().stream()
                .filter(p -> p.tMs() < corte - 3_600_000).map(ModelosEspera.Par::pred).toList();
        assertThat(b).isEqualTo(a);
    }

    @Test
    void estacionalMejorQueEmaMejorQueBaseYCoberturaRazonable() {
        var m = sintetico(40, 11);
        long ahora = m.getLast().emitidoMs() + 3_600_000;
        var base = ModelosEspera.entrenar(Tipo.BASELINE, m, 300, 0.2, 0.8, ahora).metricas();
        var ema = ModelosEspera.entrenar(Tipo.EMA, m, 300, 0.2, 0.8, ahora).metricas();
        var est = ModelosEspera.entrenar(Tipo.ESTACIONAL, m, 300, 0.2, 0.8, ahora).metricas();
        assertThat(ema.mae()).isLessThanOrEqualTo(base.mae() * 1.05);
        assertThat(est.mae()).isLessThanOrEqualTo(ema.mae() * 1.05);
        assertThat(est.cobertura()).isGreaterThan(0.6).isLessThanOrEqualTo(1);
        assertThat(ModelosEspera.importanciaPermutacion(ModelosEspera.entrenar(Tipo.ESTACIONAL, m, 300, 0.2, 0.8, ahora).estado(),
                ModelosEspera.entrenar(Tipo.ESTACIONAL, m, 300, 0.2, 0.8, ahora).pares(), 2026)).hasSize(4);
    }
}
