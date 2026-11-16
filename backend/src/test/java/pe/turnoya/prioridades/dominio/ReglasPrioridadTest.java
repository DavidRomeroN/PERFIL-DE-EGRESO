package pe.turnoya.prioridades.dominio;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;
import pe.turnoya.prioridades.dominio.ReglasPrioridad.Categoria;
import pe.turnoya.prioridades.dominio.ReglasPrioridad.Config;
import pe.turnoya.prioridades.dominio.ReglasPrioridad.TurnoRegla;
import pe.turnoya.prioridades.dominio.ReglasPrioridad.TurnoSimulado;

/** Casos de {@code legacy/backend/tests/unit/prioridades.test.ts}. */
class ReglasPrioridadTest {

    private static final Config CFG = new Config(1.5, 3, true);
    private static final Categoria GEST = new Categoria("GESTANTE", 60, false);
    private static final Categoria DISC = new Categoria("DISCAPACIDAD", 50, false);
    private static final Categoria EMER = new Categoria("EMERGENCIA", 100, true);
    private static final long T0 = Instant.parse("2026-10-13T15:00:00Z").toEpochMilli();

    private static TurnoRegla t(String id, double esperaMin, Categoria c) {
        return new TurnoRegla(id, T0 - Math.round(esperaMin * 60000), c);
    }

    private static List<String> ids(List<TurnoRegla> l) {
        return l.stream().map(TurnoRegla::id).toList();
    }

    @Test
    void mismoPesoEsFifo() {
        assertThat(ids(ReglasPrioridad.ordenar(List.of(t("b", 2, null), t("a", 5, null), t("c", 1, null)), CFG))).containsExactly("a", "b", "c");
    }

    @Test
    void laGestantePasaDelanteDeUnGeneralReciente() {
        assertThat(ReglasPrioridad.ordenar(List.of(t("A-030", 5, null), t("A-031", 1, GEST)), CFG).getFirst().id()).isEqualTo("A-031");
    }

    @Test
    void unGeneralAntiguoAlcanzaALaGestante() {
        assertThat(ReglasPrioridad.ordenar(List.of(t("A-030", 45, null), t("A-031", 1, GEST)), CFG).getFirst().id()).isEqualTo("A-030");
        assertThat(ReglasPrioridad.minutosParaAlcanzar(60, 1.5)).isEqualTo(40);
    }

    @Test
    void laEmergenciaSiempreVaPrimero() {
        assertThat(ReglasPrioridad.ordenar(List.of(t("g", 200, null), t("p", 100, GEST), t("e", 0, EMER)), CFG).getFirst().id()).isEqualTo("e");
    }

    @Test
    void topeDeAdelantos() {
        var espera = List.of(t("p1", 5, GEST), t("p2", 4, GEST), t("p3", 3, GEST), t("p4", 2, GEST), t("p5", 1, GEST), t("g", 1, null));
        var sec = ReglasPrioridad.secuenciaLlamadas(espera, CFG, 0).stream().map(x -> x.id().startsWith("p") ? "P" : "G").toList();
        assertThat(sec).containsExactly("P", "P", "P", "G", "P", "P");
    }

    @Test
    void sinTopeNoHayRachaForzada() {
        var espera = List.of(t("p1", 3, GEST), t("p2", 2, GEST), t("g", 1, null));
        assertThat(ReglasPrioridad.seleccionarSiguiente(espera, new Config(1.5, 0, true), 99).turno().id()).isEqualTo("p1");
    }

    @Test
    void sinAgingNoHayCruce() {
        assertThat(ReglasPrioridad.ordenar(List.of(t("g", 500, null), t("p", 0, GEST)), new Config(1.5, 3, false)).getFirst().id()).isEqualTo("p");
    }

    @Test
    void laEmergenciaNoAlteraLaRacha() {
        assertThat(ReglasPrioridad.seleccionarSiguiente(List.of(t("e", 0, EMER)), CFG, 2).racha()).isEqualTo(2);
    }

    @Test
    void explicarPuntajeComoElPrototipo() {
        var e = ReglasPrioridad.explicarPuntaje(t("A-031", 21, DISC), CFG, T0);
        assertThat(Math.round(e.total())).isEqualTo(82);
        assertThat(e.texto()).contains("50 (base");
    }

    @Test
    void simularFifoContraPriorizado() {
        var r = ReglasPrioridad.simular(List.of(new TurnoSimulado("A-030", "GENERAL", 38), new TurnoSimulado("A-031", "DISCAPACIDAD", 21),
                new TurnoSimulado("A-033", "GESTANTE", 9)), List.of(GEST, DISC), CFG, T0);
        assertThat(r.fifo()).containsExactly("A-030", "A-031", "A-033");
        assertThat(r.priorizado()).containsExactly("A-031", "A-033", "A-030");
        assertThat(Math.round(r.puntajes().get("A-031"))).isEqualTo(82);
    }

    @Test
    void nuncaMasDeTopePreferentesSeguidosMientrasHayaUnGeneral() {
        for (int semilla = 1; semilla <= 200; semilla++) {
            var sec = ReglasPrioridad.secuenciaLlamadas(aleatorios(semilla, 12), CFG, 0);
            int racha = 0;
            for (int i = 0; i < sec.size(); i++) {
                boolean quedanGenerales = sec.subList(i, sec.size()).stream().anyMatch(x -> x.categoria() == null);
                racha = sec.get(i).categoria() != null && !sec.get(i).categoria().absoluta() ? racha + 1 : 0;
                if (quedanGenerales) {
                    assertThat(racha).as("semilla %d", semilla).isLessThanOrEqualTo(CFG.tope());
                }
            }
        }
    }

    @Test
    void elOrdenNoCambiaAlAvanzarElReloj() {
        for (int semilla = 1; semilla <= 100; semilla++) {
            var espera = aleatorios(semilla, 10);
            for (int i = 0; i < espera.size(); i++) {
                for (int j = 0; j < espera.size(); j++) {
                    double a1 = ReglasPrioridad.explicarPuntaje(espera.get(i), CFG, T0).total() - ReglasPrioridad.explicarPuntaje(espera.get(j), CFG, T0).total();
                    double a2 = ReglasPrioridad.explicarPuntaje(espera.get(i), CFG, T0 + 3_600_000).total()
                            - ReglasPrioridad.explicarPuntaje(espera.get(j), CFG, T0 + 3_600_000).total();
                    assertThat(Math.signum(Math.round(a1 * 10))).isEqualTo(Math.signum(Math.round(a2 * 10)));
                }
            }
        }
    }

    private static List<TurnoRegla> aleatorios(int semilla, int n) {
        Random rng = new Random(semilla);
        Categoria[] cats = {null, GEST, DISC};
        List<TurnoRegla> l = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            l.add(t("x" + i, rng.nextInt(120), cats[rng.nextInt(cats.length)]));
        }
        return l;
    }
}
