package pe.turnoya.compartido.estadistica;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.function.DoubleSupplier;

/** Utilidades estadísticas puras (M2 §6, M7 §6.1, M8): cuantiles, media, winsorización y un PRNG reproducible. */
public final class Estadistica {

    private Estadistica() {
    }

    /** Cuantil tipo 7 (interpolación lineal; el de R, Excel y {@code percentile_cont}). */
    public static double cuantil(Collection<? extends Number> valores, double p) {
        if (valores.isEmpty()) {
            return 0;
        }
        double[] xs = valores.stream().mapToDouble(Number::doubleValue).sorted().toArray();
        return cuantilOrdenado(xs, p);
    }

    public static double cuantil(double[] valores, double p) {
        if (valores.length == 0) {
            return 0;
        }
        double[] xs = valores.clone();
        Arrays.sort(xs);
        return cuantilOrdenado(xs, p);
    }

    public static double cuantilOrdenado(double[] xs, double p) {
        if (xs.length == 0) {
            return 0;
        }
        double pos = (xs.length - 1) * Math.min(1, Math.max(0, p));
        int lo = (int) Math.floor(pos);
        int hi = (int) Math.ceil(pos);
        if (lo == hi) {
            return xs[lo];
        }
        return xs[lo] * (hi - pos) + xs[hi] * (pos - lo);
    }

    public static double mediana(Collection<? extends Number> valores) {
        return cuantil(valores, 0.5);
    }

    public static double media(Collection<? extends Number> valores) {
        return valores.isEmpty() ? 0 : valores.stream().mapToDouble(Number::doubleValue).sum() / valores.size();
    }

    public static double media(double[] valores) {
        return valores.length == 0 ? 0 : Arrays.stream(valores).sum() / valores.length;
    }

    /** Acota los valores al percentil {@code p} superior (RN-M2-03 usa 0.99). */
    public static List<Double> winsorizar(List<Double> valores, double p) {
        if (valores.size() < 3) {
            return new ArrayList<>(valores);
        }
        double tope = cuantil(valores, p);
        return valores.stream().map(v -> Math.min(v, tope)).toList();
    }

    /** Desviación absoluta mediana. */
    public static double mad(List<Double> valores) {
        double m = mediana(valores);
        return mediana(valores.stream().map(v -> Math.abs(v - m)).toList());
    }

    /** PRNG mulberry32 (32 bits) con semilla: reproducible y con la misma secuencia que el sistema anterior. */
    public static DoubleSupplier mulberry32(int semilla) {
        int[] a = {semilla};
        return () -> {
            a[0] = a[0] + 0x6d2b79f5;
            int t = a[0];
            t = (t ^ (t >>> 15)) * (t | 1);
            t ^= t + (t ^ (t >>> 7)) * (t | 61);
            return Integer.toUnsignedLong(t ^ (t >>> 14)) / 4294967296.0;
        };
    }

    /** Barajado Fisher–Yates con un generador dado. */
    public static <T> List<T> barajar(List<T> xs, DoubleSupplier rng) {
        List<T> a = new ArrayList<>(xs);
        for (int i = a.size() - 1; i > 0; i--) {
            int j = (int) Math.floor(rng.getAsDouble() * (i + 1));
            T tmp = a.get(i);
            a.set(i, a.get(j));
            a.set(j, tmp);
        }
        return a;
    }
}
