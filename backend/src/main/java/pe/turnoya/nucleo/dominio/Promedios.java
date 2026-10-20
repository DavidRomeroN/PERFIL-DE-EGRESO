package pe.turnoya.nucleo.dominio;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.Objects;

/** Cálculos de métricas (reglas puras, sin BD). */
public final class Promedios {

    private Promedios() {
    }

    /** Promedio en minutos con un decimal, ignorando valores nulos o negativos. 0 si no hay datos. */
    public static double minutos(Collection<Long> milisegundos) {
        var validos = milisegundos.stream().filter(Objects::nonNull).filter(ms -> ms >= 0).toList();
        if (validos.isEmpty()) {
            return 0;
        }
        double promedio = validos.stream().mapToLong(Long::longValue).average().orElse(0);
        return Math.round(promedio / 60000 * 10) / 10.0;
    }

    /** Milisegundos entre dos instantes, o nulo si falta alguno. */
    public static Long entre(Instant desde, Instant hasta) {
        return desde == null || hasta == null ? null : Duration.between(desde, hasta).toMillis();
    }

    /** Porcentaje con un decimal. */
    public static double porcentaje1(int parte, int total) {
        return total == 0 ? 0 : Math.round(parte * 1000.0 / total) / 10.0;
    }

    /** Porcentaje entero. */
    public static int porcentaje(int parte, int total) {
        return total == 0 ? 0 : (int) Math.round(parte * 100.0 / total);
    }
}
