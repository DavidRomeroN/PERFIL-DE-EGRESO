package pe.turnoya.simulador.dominio;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.PriorityQueue;
import java.util.Set;
import java.util.function.DoubleSupplier;
import java.util.function.IntUnaryOperator;
import java.util.function.DoubleUnaryOperator;
import pe.turnoya.compartido.estadistica.Estadistica;
import pe.turnoya.compartido.tiempo.Fechas;

/**
 * Simulación de eventos discretos + Monte Carlo (§6.2–6.7 del documento de M8), portada del sistema anterior con los
 * mismos generadores: cada réplica usa un flujo de números por fuente (llegadas, atención, paciencia, no-show,
 * aceptación), así dos escenarios con la misma semilla ven las mismas llegadas (números aleatorios comunes).
 */
public final class SimulacionEventos {

    public static final String VERSION_MOTOR = "des-1.0";
    public static final int MAX_REPLICAS = 5000;

    private static final int LLEGADAS = 0;
    private static final int SERVICIO = 1;
    private static final int PACIENCIA = 2;
    private static final int NOSHOW = 3;
    private static final int ACEPTACION = 4;

    private SimulacionEventos() {
    }

    public record Replica(double esperaMedia, double esperaP90, double pctSla, double utilizacion, int colaMax, double colaMedia,
                          double abandonoPct, int noShows, int atendidos, int llegadas, int backlog, double costo, double[] esperas) {
    }

    /** Media, desviación e intervalo de confianza del 95 % (t de Student). */
    public record Resumen(double media, double desv, double icInferior, double icSuperior) {
    }

    public record Barra(int minuto, int n) {
    }

    public record MonteCarlo(int replicas, int semilla, Resumen esperaMedia, Resumen esperaP90, Resumen pctSla, Resumen utilizacion,
                             Resumen colaMax, Resumen abandonoPct, Resumen backlog, Resumen costo, boolean cumpleSla, List<Barra> histograma) {
    }

    public record Factor(String factor, double deltaSl) {
    }

    /** seed = hash32(semillaBase, réplica, flujo) (SplitMix32), igual que el sistema anterior. */
    static int semillaFlujo(int base, int replica, int flujo) {
        int z = base ^ ((replica + 1) * 0x9e3779b9) ^ ((flujo + 1) * 0x85ebca6b);
        z = (z ^ (z >>> 16)) * 0x85ebca6b;
        z = (z ^ (z >>> 13)) * 0xc2b2ae35;
        return z ^ (z >>> 16);
    }

    static double exponencial(DoubleSupplier u, double media) {
        return -Math.log(1 - u.getAsDouble()) * media;
    }

    /** Normal estándar por Box–Muller. */
    static double normal(DoubleSupplier u) {
        double u1 = Math.max(u.getAsDouble(), 1e-12);
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u.getAsDouble());
    }

    /** Log-normal con media y CV dados: σ² = ln(1 + cv²), μ = ln(media) − σ²/2. */
    static double logNormal(DoubleSupplier u, double media, double cv) {
        double s2 = Math.log(1 + cv * cv);
        return Math.exp(Math.log(media) - s2 / 2 + Math.sqrt(s2) * normal(u));
    }

    public record AjusteLogNormal(double mu, double sigma, double media, double cv) {
    }

    /** Ajuste log-normal por máxima verosimilitud (media y desviación de ln x). */
    public static AjusteLogNormal ajustarLogNormal(List<Double> xs) {
        double[] ls = xs.stream().filter(x -> x > 0).mapToDouble(Math::log).toArray();
        int n = Math.max(1, ls.length);
        double mu = Arrays.stream(ls).sum() / n;
        double s2 = Arrays.stream(ls).map(l -> (l - mu) * (l - mu)).sum() / n;
        return new AjusteLogNormal(mu, Math.sqrt(s2), Math.exp(mu + s2 / 2), Math.sqrt(Math.exp(s2) - 1));
    }

    private enum Tipo { LLEGADA, FIN, ABANDONO, CAMBIO_C }

    private record Evento(double t, long seq, Tipo tipo, int cliente, int servidor) {
    }

    /** Función escalonada a partir de tramos (minutos desde la apertura). */
    private static DoubleUnaryOperator escalones(List<double[]> tramos, double defecto) {
        List<double[]> ord = new ArrayList<>(tramos);
        ord.sort(Comparator.comparingDouble(x -> x[0]));
        return min -> {
            double v = ord.isEmpty() ? defecto : ord.getFirst()[1];
            for (double[] x : ord) {
                if (x[0] <= min) {
                    v = x[1];
                }
            }
            return v;
        };
    }

    /** Una réplica del día simulado (§6.2). */
    public static Replica replica(ParametrosSimulacion p, int replica) {
        int ap = Fechas.minutosDe(p.apertura());
        double duracion = Math.max(1, Fechas.minutosDe(p.cierre()) - ap);
        DoubleSupplier uLlegadas = Estadistica.mulberry32(semillaFlujo(p.semilla(), replica, LLEGADAS));
        DoubleSupplier uServicio = Estadistica.mulberry32(semillaFlujo(p.semilla(), replica, SERVICIO));
        DoubleSupplier uPaciencia = Estadistica.mulberry32(semillaFlujo(p.semilla(), replica, PACIENCIA));
        DoubleSupplier uNoShow = Estadistica.mulberry32(semillaFlujo(p.semilla(), replica, NOSHOW));
        DoubleSupplier uAcept = Estadistica.mulberry32(semillaFlujo(p.semilla(), replica, ACEPTACION));

        DoubleUnaryOperator lambda = escalones(p.lambdaPorHora().stream().map(x -> new double[] {Fechas.minutosDe(x.desde()) - ap, x.valor() / 60}).toList(), 0);
        DoubleUnaryOperator cDe = escalones(p.ventanillas().stream().map(x -> new double[] {Fechas.minutosDe(x.desde()) - ap, Math.max(0, x.c())}).toList(), 1);
        double lambdaMax = Math.max(1e-9, p.lambdaPorHora().stream().mapToDouble(x -> x.valor() / 60).max().orElse(0));
        List<Double> muestras = p.servicio().muestras().stream().filter(x -> x > 0).toList();
        var srv = p.servicio();
        DoubleSupplier servicio = switch (srv.tipo()) {
            case EXPONENCIAL -> () -> exponencial(uServicio, srv.mediaMin());
            case LOGNORMAL -> () -> logNormal(uServicio, srv.mediaMin(), srv.cv() > 0 ? srv.cv() : 0.6);
            case EMPIRICA -> muestras.isEmpty() ? () -> exponencial(uServicio, srv.mediaMin())
                    : () -> muestras.get((int) Math.floor(uServicio.getAsDouble() * muestras.size()));
        };

        PriorityQueue<Evento> heap = new PriorityQueue<>(Comparator.comparingDouble(Evento::t).thenComparingLong(Evento::seq));
        long[] seq = {0};
        java.util.function.Consumer<Evento> push = heap::add;

        // Llegadas no homogéneas por adelgazamiento (Lewis–Shedler); NaN = no hay más llegadas antes del cierre
        DoubleUnaryOperator siguienteLlegada = desde -> {
            double t = desde;
            for (;;) {
                t += exponencial(uLlegadas, 1 / lambdaMax);
                if (t >= duracion) {
                    return Double.NaN;
                }
                if (uAcept.getAsDouble() <= lambda.applyAsDouble(t) / lambdaMax) {
                    return t;
                }
            }
        };
        double t0 = siguienteLlegada.applyAsDouble(0);
        if (!Double.isNaN(t0)) {
            push.accept(new Evento(t0, seq[0]++, Tipo.LLEGADA, -1, -1));
        }
        for (var tr : p.ventanillas()) {
            double m = Fechas.minutosDe(tr.desde()) - ap;
            if (m > 0 && m < duracion) {
                push.accept(new Evento(m, seq[0]++, Tipo.CAMBIO_C, -1, -1));
            }
        }

        List<Double> llegada = new ArrayList<>();
        ArrayDeque<Integer> enCola = new ArrayDeque<>();
        Set<Integer> quitado = new HashSet<>();
        int cObjetivo = (int) cDe.applyAsDouble(0);
        int maxC = Math.max(1, Math.max(cObjetivo, p.ventanillas().stream().mapToInt(ParametrosSimulacion.TramoVentanillas::c).max().orElse(1)));
        List<Boolean> ocupado = new ArrayList<>(java.util.Collections.nCopies(maxC, false));
        int[] estado = new int[4]; // 0 abiertas, 1 ocupados, 2 noShows, 3 atendidos
        estado[0] = cObjetivo;
        List<Double> esperas = new ArrayList<>();
        int abandonos = 0;
        double tiempoOcupado = 0;
        double tiempoDisponible = 0;
        int colaMax = 0;
        double areaCola = 0;
        double ultimo = 0;

        IntUnaryOperator libre = x -> {
            for (int i = 0; i < estado[0]; i++) {
                if (!ocupado.get(i)) {
                    return i;
                }
            }
            return -1;
        };

        double limite = duracion + 8 * 60; // drenaje: se atiende a quien quedó al cierre
        for (Evento e = heap.poll(); e != null && e.t() <= limite; e = heap.poll()) {
            double dt = e.t() - ultimo;
            int enEspera = enCola.size() - quitado.size();
            areaCola += Math.max(0, enEspera) * dt;
            tiempoOcupado += estado[1] * dt;
            tiempoDisponible += Math.max(estado[0], estado[1]) * dt;
            ultimo = e.t();

            switch (e.tipo()) {
                case LLEGADA -> {
                    int id = llegada.size();
                    llegada.add(e.t());
                    double sig = siguienteLlegada.applyAsDouble(e.t());
                    if (!Double.isNaN(sig)) {
                        push.accept(new Evento(sig, seq[0]++, Tipo.LLEGADA, -1, -1));
                    }
                    int s = libre.applyAsInt(0);
                    if (s >= 0) {
                        iniciar(s, id, e.t(), p, ocupado, estado, llegada, esperas, uNoShow, servicio, heap, seq);
                    } else {
                        enCola.add(id);
                        colaMax = Math.max(colaMax, enCola.size() - quitado.size());
                        if (p.pacienciaMediaMin() != null) {
                            push.accept(new Evento(e.t() + exponencial(uPaciencia, p.pacienciaMediaMin()), seq[0]++, Tipo.ABANDONO, id, -1));
                        }
                    }
                }
                case FIN -> {
                    estado[3]++;
                    ocupado.set(e.servidor(), false);
                    estado[1]--;
                    // RN-M8-06: una ventanilla que debe cerrar termina su atención y luego cierra
                    if (e.servidor() < estado[0]) {
                        tomarSiguiente(e.servidor(), e.t(), enCola, quitado, p, ocupado, estado, llegada, esperas, uNoShow, servicio, heap, seq);
                    }
                }
                case ABANDONO -> {
                    if (enCola.contains(e.cliente()) && quitado.add(e.cliente())) {
                        abandonos++;
                    }
                }
                case CAMBIO_C -> {
                    cObjetivo = (int) cDe.applyAsDouble(e.t());
                    while (ocupado.size() < cObjetivo) {
                        ocupado.add(false);
                    }
                    estado[0] = cObjetivo;
                    for (int i = 0; i < estado[0]; i++) {
                        if (!ocupado.get(i)) {
                            tomarSiguiente(i, e.t(), enCola, quitado, p, ocupado, estado, llegada, esperas, uNoShow, servicio, heap, seq);
                        }
                    }
                }
            }
            if (e.t() >= duracion && estado[0] == 0) {
                break;
            }
        }
        int noShows = estado[2];
        int atendidos = estado[3] - noShows;
        int backlog = enCola.size() - quitado.size();
        double[] w = esperas.stream().mapToDouble(Double::doubleValue).toArray();
        double[] ord = w.clone();
        Arrays.sort(ord);
        double p90 = ord.length == 0 ? 0 : ord[Math.min(ord.length - 1, (int) Math.floor(0.9 * (ord.length - 1)))];
        double totalEspera = Arrays.stream(w).sum();
        double costo = 0;
        if (p.costos() != null) {
            var vs = p.ventanillas();
            for (int i = 0; i < vs.size(); i++) {
                double desde = Math.max(0, Fechas.minutosDe(vs.get(i).desde()) - ap);
                double hasta = i + 1 < vs.size() ? Fechas.minutosDe(vs.get(i + 1).desde()) - ap : duracion;
                costo += vs.get(i).c() * p.costos().ventanillaHora() * Math.max(0, hasta - desde) / 60;
            }
            costo += totalEspera * p.costos().esperaMinuto();
        }
        long cumplen = Arrays.stream(w).filter(x -> x <= p.slaEsperaMaxMin()).count();
        return new Replica(w.length == 0 ? 0 : totalEspera / w.length, p90, w.length == 0 ? 1 : (double) cumplen / w.length,
                tiempoDisponible > 0 ? tiempoOcupado / tiempoDisponible : 0, colaMax, ultimo > 0 ? areaCola / ultimo : 0,
                llegada.isEmpty() ? 0 : (double) abandonos / llegada.size(), noShows, atendidos, llegada.size(), backlog, costo, w);
    }

    private static void iniciar(int servidor, int cliente, double t, ParametrosSimulacion p, List<Boolean> ocupado, int[] estado, List<Double> llegada,
                                List<Double> esperas, DoubleSupplier uNoShow, DoubleSupplier servicio, PriorityQueue<Evento> heap, long[] seq) {
        ocupado.set(servidor, true);
        estado[1]++;
        double espera = t - llegada.get(cliente);
        // RN-M8-05: con probabilidad p el llamado no se presenta y la ventanilla pierde unos minutos
        if (p.noShow() != null && uNoShow.getAsDouble() < p.noShow().p()) {
            estado[2]++;
            heap.add(new Evento(t + p.noShow().minutos(), seq[0]++, Tipo.FIN, -1, servidor));
            return;
        }
        esperas.add(espera);
        heap.add(new Evento(t + servicio.getAsDouble(), seq[0]++, Tipo.FIN, -1, servidor));
    }

    private static void tomarSiguiente(int servidor, double t, ArrayDeque<Integer> enCola, Set<Integer> quitado, ParametrosSimulacion p,
                                       List<Boolean> ocupado, int[] estado, List<Double> llegada, List<Double> esperas, DoubleSupplier uNoShow,
                                       DoubleSupplier servicio, PriorityQueue<Evento> heap, long[] seq) {
        while (!enCola.isEmpty()) {
            int cl = enCola.poll();
            if (quitado.remove(cl)) {
                continue;
            }
            iniciar(servidor, cl, t, p, ocupado, estado, llegada, esperas, uNoShow, servicio, heap, seq);
            return;
        }
    }

    // --- Monte Carlo e intervalos de confianza (§6.3) ---

    private static final int[] GL = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 29};
    private static final double[] T975 = {12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.131, 2.086, 2.06, 2.045};

    static double tStudent975(int gl) {
        if (gl >= 30) {
            return 1.96;
        }
        double t = T975[0];
        for (int i = 0; i < GL.length; i++) {
            if (GL[i] <= gl) {
                t = T975[i];
            }
        }
        return t;
    }

    public static Resumen resumir(double[] xs) {
        int n = xs.length;
        if (n == 0) {
            return new Resumen(0, 0, 0, 0);
        }
        double m = Arrays.stream(xs).sum() / n;
        double d = n > 1 ? Math.sqrt(Arrays.stream(xs).map(x -> (x - m) * (x - m)).sum() / (n - 1)) : 0;
        double h = n > 1 ? tStudent975(n - 1) * d / Math.sqrt(n) : 0;
        return new Resumen(m, d, m - h, m + h);
    }

    public static MonteCarlo monteCarlo(ParametrosSimulacion p) {
        int r = Math.min(MAX_REPLICAS, Math.max(1, p.replicas()));
        int[] hist = new int[61];
        double[][] col = new double[8][r];
        for (int i = 0; i < r; i++) {
            Replica x = replica(p, i);
            for (double w : x.esperas()) {
                hist[(int) Math.min(60, Math.floor(w))]++;
            }
            col[0][i] = x.esperaMedia();
            col[1][i] = x.esperaP90();
            col[2][i] = x.pctSla();
            col[3][i] = x.utilizacion();
            col[4][i] = x.colaMax();
            col[5][i] = x.abandonoPct();
            col[6][i] = x.backlog();
            col[7][i] = x.costo();
        }
        Resumen sla = resumir(col[2]);
        List<Barra> histograma = new ArrayList<>();
        for (int m = 0; m < hist.length; m++) {
            histograma.add(new Barra(m, hist[m]));
        }
        return new MonteCarlo(r, p.semilla(), resumir(col[0]), resumir(col[1]), sla, resumir(col[3]), resumir(col[4]), resumir(col[5]),
                resumir(col[6]), resumir(col[7]), sla.media() * 100 >= p.slaObjetivoPct(), histograma);
    }

    /** Sensibilidad (tornado, §6.6): cambio del % que cumple el SLA respecto del caso base para cada factor, con CRN. */
    public static List<Factor> tornado(ParametrosSimulacion p, int replicas) {
        ParametrosSimulacion base = p.conReplicas(replicas);
        double ref = slaMedio(base);
        List<Factor> factores = new ArrayList<>(List.of(
                new Factor("Llegadas −20 %", slaMedio(base.escalarLlegadas(0.8)) - ref),
                new Factor("Llegadas +20 %", slaMedio(base.escalarLlegadas(1.2)) - ref),
                new Factor("Atención −20 %", slaMedio(base.escalarServicio(0.8)) - ref),
                new Factor("Atención +20 %", slaMedio(base.escalarServicio(1.2)) - ref),
                new Factor("Ventanillas −1", slaMedio(base.sumarVentanillas(-1)) - ref),
                new Factor("Ventanillas +1", slaMedio(base.sumarVentanillas(1)) - ref)));
        factores.sort(Comparator.comparingDouble((Factor f) -> Math.abs(f.deltaSl())).reversed());
        return factores;
    }

    private static double slaMedio(ParametrosSimulacion q) {
        double[] xs = new double[q.replicas()];
        for (int r = 0; r < xs.length; r++) {
            xs[r] = replica(q, r).pctSla();
        }
        return resumir(xs).media();
    }
}
