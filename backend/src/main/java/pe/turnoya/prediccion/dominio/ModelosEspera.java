package pe.turnoya.prediccion.dominio;

import static pe.turnoya.compartido.estadistica.Estadistica.cuantil;
import static pe.turnoya.compartido.estadistica.Estadistica.media;
import static pe.turnoya.compartido.estadistica.Estadistica.mediana;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.DoubleSupplier;
import pe.turnoya.compartido.estadistica.Estadistica;

/**
 * M2 · Modelos de predicción de espera (docs/modulos/M2-prediccion-espera.md §6). Funciones puras.
 *
 * <pre>
 *   W = espera hasta ser llamado (segundos) · k = personas delante · c = ventanillas operativas
 *   BASELINE   W = (k + 1) · promedio(últimos 10 servicios)                     (RN02)
 *   EMA        W = ((k + 1) / c) · s̄,   s̄ ← α·x + (1 − α)·s̄
 *   ESTACIONAL W = φ_{d,b} · ((k + 1) / c) · s̄_{d,b},  s̄_{d,b} con contracción hacia la mediana de la cola (κ = 10)
 * </pre>
 *
 * El estado se actualiza solo con información ya ocurrida (cierres de atención y llamados), por eso el replay
 * cronológico no tiene fuga de datos (RNF-M2-03).
 */
public final class ModelosEspera {

    public enum Tipo { BASELINE, EMA, ESTACIONAL }

    public static final List<Tipo> TIPOS = List.of(Tipo.BASELINE, Tipo.EMA, Tipo.ESTACIONAL);
    public static final int KAPPA = 10;
    public static final double ALFA_PHI = 0.2;
    public static final double SERVICIO_MIN_SEG = 30;
    public static final double SERVICIO_MAX_SEG = 3600;
    private static final int MAX_CELDA = 60;
    private static final double[] SIN_CALIBRAR = {0.65, 1.45};

    private ModelosEspera() {
    }

    /**
     * Estado del modelo de una cola. Se guarda como JSON en {@code modelo_entrenado.parametros} con los mismos nombres
     * de campo que el sistema anterior (los modelos ya entrenados siguen sirviendo).
     */
    public static final class Estado {
        public Tipo tipo;
        public double base;
        public double alfa;
        public List<Double> ultimos = new ArrayList<>();
        public double sbar;
        /** Servicios recientes por celda "dow-franja" (para la mediana de la celda). */
        public Map<String, List<Double>> celdas = new HashMap<>();
        /** Todos los servicios recientes de la cola (mediana m_q). */
        public List<Double> cola = new ArrayList<>();
        /** Corrección multiplicativa por celda, acotada a [0.5, 2]. */
        public Map<String, Double> phi = new HashMap<>();
        /** Cuantiles del error relativo para el intervalo, por grupo horario. */
        public Intervalo intervalo = new Intervalo();
        public int nServicios;

        public Estado copia() {
            Estado e = new Estado();
            e.tipo = tipo;
            e.base = base;
            e.alfa = alfa;
            e.ultimos = new ArrayList<>(ultimos);
            e.sbar = sbar;
            celdas.forEach((k, v) -> e.celdas.put(k, new ArrayList<>(v)));
            e.cola = new ArrayList<>(cola);
            e.phi = new HashMap<>(phi);
            e.intervalo = new Intervalo(intervalo.manana, intervalo.tarde, intervalo.cola);
            e.nServicios = nServicios;
            return e;
        }
    }

    public static final class Intervalo {
        public double[] manana;
        public double[] tarde;
        public double[] cola;

        public Intervalo() {
        }

        public Intervalo(double[] manana, double[] tarde, double[] cola) {
            this.manana = manana;
            this.tarde = tarde;
            this.cola = cola;
        }
    }

    public record MuestraTurno(int id, long emitidoMs, Long llamadoMs, Long finalizadoMs, boolean atendido, int delante, int c, int dow,
                               int franja) {
    }

    public record Par(int id, long tMs, double pred, double real, double lo, double hi, int k, int c, int dow, int franja) {

        Par conIntervalo(double lo, double hi) {
            return new Par(id, tMs, pred, real, lo, hi, k, c, dow, franja);
        }
    }

    public record Metricas(int n, double mae, double medae, double mape, double acierto5, double sesgo, double cobertura, double anchoMedio) {
        static final Metricas VACIAS = new Metricas(0, 0, 0, 0, 0, 0, 0, 0);
    }

    public record Rango(double lo, double hi) {
    }

    public record Importancia(String variable, double importancia) {
    }

    public record Entrenamiento(Estado estado, Metricas metricas, List<Par> pares) {
    }

    public static Estado estadoInicial(Tipo tipo, double base, double alfa) {
        Estado e = new Estado();
        e.tipo = tipo;
        e.base = base;
        e.alfa = alfa;
        e.sbar = base;
        return e;
    }

    public static String celda(int dow, int franja) {
        return dow + "-" + franja;
    }

    public static boolean servicioValido(double seg) {
        return seg >= SERVICIO_MIN_SEG && seg <= SERVICIO_MAX_SEG;
    }

    /** Actualización en línea al cerrar una atención (EMA, celdas y baseline). Muta el estado. */
    public static Estado actualizarServicio(Estado e, double servicioSeg, int dow, int franja) {
        if (!servicioValido(servicioSeg)) {
            return e;
        }
        // Winsorización en línea al p99 aproximado de lo visto
        double tope = e.cola.size() >= 20 ? cuantil(e.cola, 0.99) : SERVICIO_MAX_SEG;
        double x = Math.min(servicioSeg, tope);
        e.ultimos.add(x);
        if (e.ultimos.size() > 10) {
            e.ultimos.removeFirst();
        }
        e.sbar = e.nServicios == 0 ? x : e.alfa * x + (1 - e.alfa) * e.sbar;
        List<Double> lista = e.celdas.computeIfAbsent(celda(dow, franja), k -> new ArrayList<>());
        lista.add(x);
        if (lista.size() > MAX_CELDA) {
            lista.removeFirst();
        }
        e.cola.add(x);
        if (e.cola.size() > 500) {
            e.cola.removeFirst();
        }
        e.nServicios++;
        return e;
    }

    /** s̄_{d,b} con contracción empírico-Bayes hacia la mediana de la cola. */
    public static double servicioCelda(Estado e, int dow, int franja) {
        double mq = e.cola.isEmpty() ? e.base : mediana(e.cola);
        List<Double> xs = e.celdas.getOrDefault(celda(dow, franja), List.of());
        if (xs.isEmpty()) {
            return mq;
        }
        int n = xs.size();
        return (n * mediana(xs) + KAPPA * mq) / (n + KAPPA);
    }

    private static double phiDe(Estado e, int dow, int franja) {
        Double exacto = e.phi.get(celda(dow, franja));
        if (exacto != null) {
            return exacto;
        }
        // Franja vecina más cercana del mismo día; en último caso 1
        for (int d = 1; d <= 4; d++) {
            Double a = e.phi.get(celda(dow, franja - d));
            if (a != null) {
                return a;
            }
            Double b = e.phi.get(celda(dow, franja + d));
            if (b != null) {
                return b;
            }
        }
        return 1;
    }

    /** Predicción puntual (segundos). */
    public static double predecir(Estado e, int k, int c, int dow, int franja) {
        int kk = Math.max(0, k);
        int cc = Math.max(1, c);
        if (e.tipo == Tipo.BASELINE) {
            double prom = e.ultimos.isEmpty() ? e.base : media(e.ultimos);
            return (kk + 1) * (prom < SERVICIO_MIN_SEG ? e.base : prom);
        }
        if (e.tipo == Tipo.EMA) {
            return ((kk + 1) / (double) cc) * e.sbar;
        }
        double est = ((kk + 1) / (double) cc) * servicioCelda(e, dow, franja);
        return phiDe(e, dow, franja) * est;
    }

    /** Aprende φ cuando se revela la espera real de una emisión (solo ESTACIONAL). */
    public static Estado actualizarPhi(Estado e, double realSeg, double estructuralSeg, int dow, int franja) {
        if (e.tipo != Tipo.ESTACIONAL || estructuralSeg <= 0) {
            return e;
        }
        double r = Math.min(2, Math.max(0.5, realSeg / Math.max(estructuralSeg, SERVICIO_MIN_SEG)));
        String k = celda(dow, franja);
        double previo = e.phi.getOrDefault(k, 1.0);
        e.phi.put(k, Math.min(2, Math.max(0.5, ALFA_PHI * r + (1 - ALFA_PHI) * previo)));
        return e;
    }

    public static double estructural(Estado e, int k, int c, int dow, int franja) {
        return ((Math.max(0, k) + 1) / (double) Math.max(1, c)) * servicioCelda(e, dow, franja);
    }

    /** Intervalo [lo, hi] (§6.5): pred × cuantiles del error relativo; si no hay calibración, [0.65, 1.45]. */
    public static Rango intervalo(Estado e, double pred, int franja) {
        double[] grupo = franja < 26 ? e.intervalo.manana : e.intervalo.tarde;
        double[] q = grupo != null ? grupo : e.intervalo.cola != null ? e.intervalo.cola : SIN_CALIBRAR;
        return new Rango(Math.max(0, pred * q[0]), Math.max(pred, pred * q[1]));
    }

    /** Cuantiles de la conformalización dividida a partir de pares (pred, real). */
    public static Intervalo calibrarIntervalo(List<Par> pares, double nivel) {
        double qlo = (1 - nivel) / 2;
        double qhi = (1 + nivel) / 2;
        return new Intervalo(
                grupo(pares.stream().filter(p -> p.franja() < 26).toList(), 50, qlo, qhi),
                grupo(pares.stream().filter(p -> p.franja() >= 26).toList(), 50, qlo, qhi),
                grupo(pares, 30, qlo, qhi));
    }

    private static double[] grupo(List<Par> xs, int min, double qlo, double qhi) {
        if (xs.size() < min) {
            return null;
        }
        double[] r = xs.stream().mapToDouble(p -> p.real() / Math.max(p.pred(), SERVICIO_MIN_SEG)).toArray();
        return new double[] {Math.min(1, cuantil(r, qlo)), Math.max(1, cuantil(r, qhi))};
    }

    // -----------------------------------------------------------------------------------------------------------
    // Replay cronológico (walk-forward) §6.6
    // -----------------------------------------------------------------------------------------------------------

    private enum TipoEvento { EMISION, LLAMADO, CIERRE }

    private record Evento(long t, int orden, TipoEvento tipo, MuestraTurno m) {
    }

    private record Pendiente(double pred, double est, double lo, double hi) {
    }

    public record Replay(List<Par> pares, Estado estado) {
    }

    /**
     * Recorre los eventos en orden temporal: EMISION (predice con el estado de ese instante), LLAMADO (revela la
     * espera real y aprende φ) y CIERRE (actualiza el servicio). Devuelve los pares y el estado final.
     */
    public static Replay replay(List<MuestraTurno> muestras, Estado inicial) {
        List<Evento> eventos = new ArrayList<>();
        for (MuestraTurno m : muestras) {
            eventos.add(new Evento(m.emitidoMs(), 1, TipoEvento.EMISION, m));
            if (m.llamadoMs() != null) {
                eventos.add(new Evento(m.llamadoMs(), 0, TipoEvento.LLAMADO, m));
            }
            if (m.atendido() && m.llamadoMs() != null && m.finalizadoMs() != null) {
                eventos.add(new Evento(m.finalizadoMs(), 0, TipoEvento.CIERRE, m));
            }
        }
        // A igual instante, primero lo que ya ocurrió (cierres/llamados) y luego la emisión
        eventos.sort(Comparator.comparingLong(Evento::t).thenComparingInt(Evento::orden).thenComparingInt(ev -> ev.m().id()));
        Estado e = inicial.copia();
        Map<Integer, Pendiente> pendientes = new HashMap<>();
        List<Par> pares = new ArrayList<>();
        for (Evento ev : eventos) {
            MuestraTurno m = ev.m();
            switch (ev.tipo()) {
                case EMISION -> {
                    double pred = predecir(e, m.delante(), m.c(), m.dow(), m.franja());
                    Rango iv = intervalo(e, pred, m.franja());
                    pendientes.put(m.id(), new Pendiente(pred, estructural(e, m.delante(), m.c(), m.dow(), m.franja()), iv.lo(), iv.hi()));
                }
                case LLAMADO -> {
                    Pendiente p = pendientes.get(m.id());
                    if (p == null || m.llamadoMs() == null) {
                        continue;
                    }
                    double real = (m.llamadoMs() - m.emitidoMs()) / 1000.0;
                    if (real < 0 || real > 8 * 3600) {
                        continue;
                    }
                    pares.add(new Par(m.id(), m.emitidoMs(), p.pred(), real, p.lo(), p.hi(), m.delante(), m.c(), m.dow(), m.franja()));
                    actualizarPhi(e, real, p.est(), m.dow(), m.franja());
                    pendientes.remove(m.id());
                }
                case CIERRE -> actualizarServicio(e, (m.finalizadoMs() - m.llamadoMs()) / 1000.0, m.dow(), m.franja());
            }
        }
        return new Replay(pares, e);
    }

    public static Metricas metricas(List<Par> pares) {
        if (pares.isEmpty()) {
            return Metricas.VACIAS;
        }
        List<Double> err = pares.stream().map(p -> p.pred() - p.real()).toList();
        List<Double> abs = err.stream().map(Math::abs).toList();
        return new Metricas(
                pares.size(),
                media(abs),
                mediana(abs),
                media(pares.stream().map(p -> Math.abs(p.pred() - p.real()) / Math.max(p.real(), 120)).toList()),
                abs.stream().filter(a -> a <= 300).count() / (double) abs.size(),
                media(err),
                pares.stream().filter(p -> p.real() >= p.lo() && p.real() <= p.hi()).count() / (double) pares.size(),
                media(pares.stream().map(p -> p.hi() - p.lo()).toList()));
    }

    /** RN-M2-02: elegibilidad por arranque en frío. */
    public static List<Tipo> elegibles(int nServicios, double diasHistoria) {
        if (nServicios < 30) {
            return List.of(Tipo.BASELINE);
        }
        if (nServicios < 200 || diasHistoria < 14) {
            return List.of(Tipo.BASELINE, Tipo.EMA);
        }
        return TIPOS;
    }

    /** RN-M2-06: cambia de modelo solo si mejora el MAE en ≥ 5 %. */
    public static Tipo elegirModelo(Map<Tipo, Double> maes, Tipo activo, List<Tipo> permitidos) {
        List<Tipo> candidatos = permitidos.stream().filter(t -> maes.get(t) != null && Double.isFinite(maes.get(t))).toList();
        if (candidatos.isEmpty()) {
            return Tipo.BASELINE;
        }
        Tipo mejor = candidatos.getFirst();
        for (Tipo t : candidatos) {
            if (maes.get(t) < maes.get(mejor)) {
                mejor = t;
            }
        }
        if (activo == null || !candidatos.contains(activo)) {
            return mejor;
        }
        return maes.get(mejor) <= 0.95 * maes.get(activo) ? mejor : activo;
    }

    /** RN-M2-05: deriva si el MAE de producción supera 1.3 × el de validación. */
    public static boolean hayDeriva(double maeProduccion, double maeValidacion, int n) {
        return n >= 20 && maeValidacion > 0 && maeProduccion > 1.3 * maeValidacion;
    }

    /** §6.7 Importancia por permutación sobre variables {k, c, franja, dow} con semilla fija. */
    public static List<Importancia> importanciaPermutacion(Estado e, List<Par> pares, int semilla) {
        if (pares.size() < 10) {
            return null;
        }
        double base = media(pares.stream().map(p -> Math.abs(predecir(e, p.k(), p.c(), p.dow(), p.franja()) - p.real())).toList());
        DoubleSupplier rng = Estadistica.mulberry32(semilla);
        String[] vars = {"k", "c", "franja", "dow"};
        Map<String, String> nombres = Map.of("k", "Personas delante", "c", "Ventanillas abiertas", "franja", "Hora del día", "dow", "Día de la semana");
        Map<String, Double> delta = new LinkedHashMap<>();
        for (String v : vars) {
            List<Integer> perm = Estadistica.barajar(pares.stream().map(p -> valor(p, v)).toList(), rng);
            double suma = 0;
            for (int i = 0; i < pares.size(); i++) {
                Par p = pares.get(i);
                int k = v.equals("k") ? perm.get(i) : p.k();
                int c = v.equals("c") ? perm.get(i) : p.c();
                int dow = v.equals("dow") ? perm.get(i) : p.dow();
                int franja = v.equals("franja") ? perm.get(i) : p.franja();
                suma += Math.abs(predecir(e, k, c, dow, franja) - p.real());
            }
            delta.put(v, Math.max(0, suma / pares.size() - base));
        }
        double total = delta.values().stream().mapToDouble(Double::doubleValue).sum();
        List<Importancia> r = new ArrayList<>();
        for (String v : vars) {
            r.add(new Importancia(nombres.get(v), total > 0 ? Math.round(delta.get(v) / total * 1000) / 10.0 : 0));
        }
        return r;
    }

    private static int valor(Par p, String v) {
        return switch (v) {
            case "k" -> p.k();
            case "c" -> p.c();
            case "dow" -> p.dow();
            default -> p.franja();
        };
    }

    /** Entrena un tipo de modelo: replay completo, métricas en los últimos 7 días e intervalos calibrados sin fuga. */
    public static Entrenamiento entrenar(Tipo tipo, List<MuestraTurno> muestras, double base, double alfa, double nivel, long ahoraMs) {
        Replay rp = replay(muestras, estadoInicial(tipo, base, alfa));
        List<Par> pares = rp.pares();
        Estado estado = rp.estado();
        long corteEval = ahoraMs - 7 * 86_400_000L;
        long corteCal = corteEval - 14 * 86_400_000L;
        // Intervalos: se calibran con los 14 días previos a la ventana de evaluación y se miden en ella (cobertura honesta)
        Intervalo cal = calibrarIntervalo(pares.stream().filter(p -> p.tMs() >= corteCal && p.tMs() < corteEval).toList(), nivel);
        List<Par> evaluacion = pares.stream().filter(p -> p.tMs() >= corteEval).toList();
        List<Par> base7 = evaluacion.size() >= 20 ? evaluacion
                : pares.subList(Math.max(0, pares.size() - Math.max(20, pares.size() / 3)), pares.size());
        Estado conCal = estado.copia();
        conCal.intervalo = cal;
        List<Par> evalPares = base7.stream().map(p -> {
            Rango r = intervalo(conCal, p.pred(), p.franja());
            return p.conIntervalo(r.lo(), r.hi());
        }).toList();
        // Parámetros desplegados: intervalos con los 14 días más recientes
        estado.intervalo = calibrarIntervalo(pares.stream().filter(p -> p.tMs() >= ahoraMs - 14 * 86_400_000L).toList(), nivel);
        return new Entrenamiento(estado, metricas(evalPares), evalPares);
    }

    /** MAE por tipo (infinito si no hubo muestras de evaluación). */
    public static Map<Tipo, Double> maes(Map<Tipo, Entrenamiento> resultados) {
        Map<Tipo, Double> m = new EnumMap<>(Tipo.class);
        resultados.forEach((t, r) -> m.put(t, r.metricas().n() > 0 ? r.metricas().mae() : Double.POSITIVE_INFINITY));
        return m;
    }
}
