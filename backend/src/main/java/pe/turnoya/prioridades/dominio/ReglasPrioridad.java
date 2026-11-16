package pe.turnoya.prioridades.dominio;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * M1 · Reglas puras del motor de prioridades (sin E/S), portadas de {@code legacy/backend/src/prioridades/reglas.ts}.
 *
 * <pre>clave = peso_efectivo − α · minutos_desde_origen(emitido)      (mayor clave ⇒ primero)</pre>
 *
 * El orden relativo de dos turnos no depende de "ahora", por eso la clave se persiste e indexa ({@code turno.clave_orden});
 * la misma cuenta la hace la función SQL {@code calcular_clave_orden}.
 */
public final class ReglasPrioridad {

    public static final long ORIGEN_CLAVE_MS = Instant.parse("2026-01-01T00:00:00Z").toEpochMilli();
    public static final double PESO_ABSOLUTO = 1_000_000;

    private ReglasPrioridad() {
    }

    /** α (puntos por minuto), tope de preferentes seguidos (0 = sin tope) y si la antigüedad suma. */
    public record Config(double alfa, int tope, boolean aging) {
    }

    public record Categoria(String codigo, int pesoBase, boolean absoluta) {
    }

    /** Turno en espera para las reglas; {@code categoria} nula = general. */
    public record TurnoRegla(String id, long emitidoMs, Categoria categoria) {
    }

    public record Seleccion(TurnoRegla turno, int racha, boolean cortoRacha) {
    }

    public record Explicacion(double base, double antiguedad, long minEspera, double total, String texto) {
    }

    public record Simulacion(List<String> fifo, List<String> priorizado, Map<String, Double> puntajes) {
    }

    public record TurnoSimulado(String codigo, String categoria, double esperaMin) {
    }

    public static double pesoEfectivo(Categoria c) {
        if (c == null) {
            return 0;
        }
        return c.absoluta() ? PESO_ABSOLUTO : c.pesoBase();
    }

    public static boolean esPreferente(Categoria c) {
        return c != null && !c.absoluta() && c.pesoBase() > 0;
    }

    public static boolean esGeneral(Categoria c) {
        return c == null || (!c.absoluta() && c.pesoBase() == 0);
    }

    public static double claveOrden(double peso, long emitidoMs, double alfa, boolean aging) {
        double minutos = (emitidoMs - ORIGEN_CLAVE_MS) / 60000.0;
        return peso - (aging ? alfa * minutos : 0);
    }

    public static double claveDe(TurnoRegla t, Config cfg) {
        return claveOrden(pesoEfectivo(t.categoria()), t.emitidoMs(), cfg.alfa(), cfg.aging());
    }

    /** Mayor clave primero; desempate por emisión y luego por id (numérico si se puede). */
    public static Comparator<TurnoRegla> comparador(Config cfg) {
        return (a, b) -> {
            int d = Double.compare(claveDe(b, cfg), claveDe(a, cfg));
            if (d != 0) {
                return d;
            }
            if (a.emitidoMs() != b.emitidoMs()) {
                return Long.compare(a.emitidoMs(), b.emitidoMs());
            }
            return compararIds(a.id(), b.id());
        };
    }

    public static List<TurnoRegla> ordenar(List<TurnoRegla> turnos, Config cfg) {
        List<TurnoRegla> copia = new ArrayList<>(turnos);
        copia.sort(comparador(cfg));
        return copia;
    }

    /**
     * Siguiente turno con tope de adelantos (RN-M1-03): tras {@code tope} preferentes seguidos pasa el primer general.
     * Es la misma decisión que hace {@code siguiente_turno()} en SQL; aquí sirve para pruebas y la vista previa.
     */
    public static Seleccion seleccionarSiguiente(List<TurnoRegla> espera, Config cfg, int racha) {
        if (espera.isEmpty()) {
            return new Seleccion(null, racha, false);
        }
        List<TurnoRegla> orden = ordenar(espera, cfg);
        TurnoRegla elegido = orden.getFirst();
        boolean corto = false;
        if (cfg.tope() > 0 && esPreferente(elegido.categoria()) && racha >= cfg.tope()) {
            var general = orden.stream().filter(t -> esGeneral(t.categoria())).findFirst();
            if (general.isPresent()) {
                elegido = general.get();
                corto = true;
            }
        }
        int nueva;
        if (elegido.categoria() != null && elegido.categoria().absoluta()) {
            nueva = racha;
        } else if (esPreferente(elegido.categoria())) {
            nueva = racha + 1;
        } else {
            nueva = 0;
        }
        return new Seleccion(elegido, nueva, corto);
    }

    /** Orden completo de llamadas (vaciando la cola) aplicando el tope. */
    public static List<TurnoRegla> secuenciaLlamadas(List<TurnoRegla> espera, Config cfg, int rachaInicial) {
        List<TurnoRegla> pendientes = new ArrayList<>(espera);
        List<TurnoRegla> salida = new ArrayList<>();
        int racha = rachaInicial;
        while (!pendientes.isEmpty()) {
            Seleccion s = seleccionarSiguiente(pendientes, cfg, racha);
            if (s.turno() == null) {
                break;
            }
            salida.add(s.turno());
            racha = s.racha();
            pendientes.remove(s.turno());
        }
        return salida;
    }

    /** Puntaje visible P(t) = peso + α·minutos de espera (§6.3). */
    public static Explicacion explicarPuntaje(TurnoRegla t, Config cfg, long ahoraMs) {
        double minEspera = Math.max(0, (ahoraMs - t.emitidoMs()) / 60000.0);
        double base = pesoEfectivo(t.categoria());
        double antiguedad = cfg.aging() ? cfg.alfa() * minEspera : 0;
        long minutos = Math.round(minEspera);
        String texto = t.categoria() != null && t.categoria().absoluta()
                ? "Atención inmediata (categoría absoluta)"
                : Math.round(base + antiguedad) + " pts = " + entero(base) + " (base" + (t.categoria() != null ? ", " + t.categoria().codigo() : "")
                + ") + " + decimal(cfg.alfa()) + " × " + minutos + " min";
        return new Explicacion(base, redondear1(antiguedad), minutos, redondear1(base + antiguedad), texto);
    }

    /** Minutos de antigüedad con que un general iguala a un preferente de peso {@code peso} (Δ = w/α). */
    public static double minutosParaAlcanzar(double peso, double alfa) {
        return alfa > 0 ? peso / alfa : Double.POSITIVE_INFINITY;
    }

    /** Orden FIFO frente al priorizado de una cola hipotética (RF-M1-09). */
    public static Simulacion simular(List<TurnoSimulado> turnos, List<Categoria> categorias, Config cfg, long ahoraMs) {
        Map<String, Categoria> mapa = categorias.stream().collect(Collectors.toMap(Categoria::codigo, Function.identity(), (a, b) -> a));
        List<TurnoRegla> items = new ArrayList<>();
        Map<String, String> codigos = new LinkedHashMap<>();
        for (int i = 0; i < turnos.size(); i++) {
            TurnoSimulado t = turnos.get(i);
            String id = String.valueOf(i);
            codigos.put(id, t.codigo());
            items.add(new TurnoRegla(id, ahoraMs - Math.round(t.esperaMin() * 60000), "GENERAL".equals(t.categoria()) ? null : mapa.get(t.categoria())));
        }
        List<String> fifo = items.stream()
                .sorted(Comparator.comparingLong(TurnoRegla::emitidoMs).thenComparing((a, b) -> compararIds(a.id(), b.id())))
                .map(t -> codigos.get(t.id())).toList();
        List<String> priorizado = secuenciaLlamadas(items, cfg, 0).stream().map(t -> codigos.get(t.id())).toList();
        Map<String, Double> puntajes = new LinkedHashMap<>();
        for (TurnoRegla t : items) {
            puntajes.put(codigos.get(t.id()), explicarPuntaje(t, cfg, ahoraMs).total());
        }
        return new Simulacion(fifo, priorizado, puntajes);
    }

    private static int compararIds(String a, String b) {
        if (a.matches("\\d+") && b.matches("\\d+")) {
            return Long.compare(Long.parseLong(a), Long.parseLong(b));
        }
        return a.compareTo(b);
    }

    private static double redondear1(double v) {
        return Math.round(v * 10) / 10.0;
    }

    private static String entero(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v);
    }

    private static String decimal(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v);
    }
}
