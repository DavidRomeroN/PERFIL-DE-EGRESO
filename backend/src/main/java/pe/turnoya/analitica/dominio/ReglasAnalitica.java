package pe.turnoya.analitica.dominio;

import java.util.ArrayList;
import java.util.List;

/** M7 · Reglas puras: SLA con censura a la derecha, anomalías (z robusto con MAD) y la máquina de estados de las alertas. */
public final class ReglasAnalitica {

    private ReglasAnalitica() {
    }

    // --- §6.3 SLA (RN-M7-01) ---

    public enum EstadoSla { CUMPLE, INCUMPLE, PENDIENTE, EXCLUIDO }

    public record TurnoSla(String estado, boolean llamado, double esperaSeg) {
    }

    /**
     * Llamado con espera ≤ máx ⇒ CUMPLE; > máx ⇒ INCUMPLE. En espera con edad > máx ⇒ ya INCUMPLE; con edad ≤ máx ⇒
     * PENDIENTE (fuera del denominador). Cancelado / no presentado cuenta solo si su espera superó el máximo.
     */
    public static EstadoSla clasificar(TurnoSla t, double maxSeg) {
        if (t.llamado()) {
            return t.esperaSeg() <= maxSeg ? EstadoSla.CUMPLE : EstadoSla.INCUMPLE;
        }
        if ("EMITIDO".equals(t.estado()) || "AVISADO".equals(t.estado())) {
            return t.esperaSeg() > maxSeg ? EstadoSla.INCUMPLE : EstadoSla.PENDIENTE;
        }
        if (("CANCELADO".equals(t.estado()) || "NO_SE_PRESENTO".equals(t.estado())) && t.esperaSeg() > maxSeg) {
            return EstadoSla.INCUMPLE;
        }
        return EstadoSla.EXCLUIDO;
    }

    /** {@code presupuestoConsumido} nulo = infinito (incumplimientos sin margen permitido). */
    public record Cumplimiento(int muestra, int cumplen, int incumplen, int pendientes, int enRiesgo, Double cumplimiento, Boolean cumple,
                               Double presupuestoConsumido) {
    }

    public static Cumplimiento cumplimientoSla(List<TurnoSla> turnos, int esperaMaxMin, double objetivoPct) {
        double maxSeg = esperaMaxMin * 60.0;
        int cumplen = 0;
        int incumplen = 0;
        int pendientes = 0;
        int enRiesgo = 0;
        for (TurnoSla t : turnos) {
            switch (clasificar(t, maxSeg)) {
                case CUMPLE -> cumplen++;
                case INCUMPLE -> incumplen++;
                case PENDIENTE -> {
                    pendientes++;
                    if (t.esperaSeg() >= 0.8 * maxSeg) {
                        enRiesgo++;
                    }
                }
                default -> {
                }
            }
        }
        int n = cumplen + incumplen;
        Double c = n == 0 ? null : (double) cumplen / n;
        double permitidos = (1 - objetivoPct / 100) * n;
        Double presupuesto = permitidos > 0 ? incumplen / permitidos : incumplen > 0 ? null : 0.0;
        return new Cumplimiento(n, cumplen, incumplen, pendientes, enRiesgo, c, c == null ? null : c * 100 >= objetivoPct, presupuesto);
    }

    // --- §6.4 Anomalías con z robusto (Iglewicz–Hoaglin) ---

    public static double mediana(List<Double> xs) {
        List<Double> o = new ArrayList<>(xs);
        o.sort(Double::compare);
        int n = o.size();
        if (n == 0) {
            return 0;
        }
        return n % 2 == 1 ? o.get(n / 2) : (o.get(n / 2 - 1) + o.get(n / 2)) / 2;
    }

    public static Double zRobusto(List<Double> base, double observado, double fraccion) {
        if (base.size() < 4 || fraccion < 0.5) {
            return null;
        }
        double med = mediana(base);
        double mad = mediana(base.stream().map(x -> Math.abs(x - med)).toList());
        double escala = Math.max(mad, 1);
        double esperado = med * fraccion;
        return (0.6745 * (observado - esperado)) / (escala * Math.sqrt(fraccion));
    }

    public static boolean esAnomalia(Double z, double umbral) {
        return z != null && Math.abs(z) > umbral;
    }

    // --- §6.5 Máquina de estados de las alertas ---

    public record Nivel(int traMin, List<String> canales) {
    }

    public static final List<Nivel> NIVELES_POR_DEFECTO = List.of(new Nivel(0, List.of("IN_APP")), new Nivel(10, List.of("IN_APP", "WHATSAPP")),
            new Nivel(30, List.of("IN_APP", "CORREO")));

    public record AlertaViva(String estado, int nivel, long primeraVezMs, Long proximoEscalaMs, Long silenciadaHastaMs, Long resueltaMs) {
    }

    public record Racha(int disparos, Long normalDesdeMs) {
    }

    public enum TipoDecision { NADA, ABRIR, REABRIR, REPETIR, RESOLVER, ESCALAR, DESILENCIAR }

    public record Decision(TipoDecision tipo, int nivel, Long proximoEscalaMs) {

        static Decision de(TipoDecision t) {
            return new Decision(t, 0, null);
        }
    }

    public record Paso(Racha racha, Decision decision) {
    }

    private static Long proximoEscala(List<Nivel> niveles, int nivelActual, long desdeMs) {
        return nivelActual < niveles.size() ? desdeMs + niveles.get(nivelActual).traMin() * 60000L : null;
    }

    /** Avanza la racha y decide qué hacer con la alerta ({@code alerta}: la viva o la última resuelta, para el anti-flapping). */
    public static Paso avanzarAlerta(boolean dispara, long ahoraMs, Racha previa, AlertaViva a, List<Nivel> niveles, int resolverTrasMin) {
        Racha racha = dispara ? new Racha(previa.disparos() + 1, null) : new Racha(0, previa.normalDesdeMs() != null ? previa.normalDesdeMs() : ahoraMs);
        boolean viva = a != null && !"RESUELTA".equals(a.estado());

        if (a != null && "SILENCIADA".equals(a.estado()) && a.silenciadaHastaMs() != null && ahoraMs >= a.silenciadaHastaMs()) {
            return new Paso(racha, Decision.de(dispara ? TipoDecision.DESILENCIAR : TipoDecision.RESOLVER));
        }
        if (dispara) {
            if (viva) {
                if (puedeEscalar(a, ahoraMs, niveles)) {
                    int nivel = a.nivel() + 1;
                    return new Paso(racha, new Decision(TipoDecision.ESCALAR, nivel, proximoEscala(niveles, nivel, a.primeraVezMs())));
                }
                return new Paso(racha, Decision.de(TipoDecision.REPETIR));
            }
            if (racha.disparos() >= 2) {
                // Anti-flapping: recurrencia ≤ 30 min tras resolverse ⇒ se reabre la misma alerta sin renotificar el nivel 1
                if (a != null && "RESUELTA".equals(a.estado()) && a.resueltaMs() != null && ahoraMs - a.resueltaMs() <= 30 * 60000L) {
                    return new Paso(racha, new Decision(TipoDecision.REABRIR, a.nivel(), proximoEscala(niveles, 1, ahoraMs)));
                }
                return new Paso(racha, new Decision(TipoDecision.ABRIR, 1, proximoEscala(niveles, 1, ahoraMs)));
            }
            return new Paso(racha, Decision.de(TipoDecision.NADA));
        }
        // Normal: se resuelve sola tras `resolverTrasMin` minutos sostenidos
        if (viva && ("ABIERTA".equals(a.estado()) || "RECONOCIDA".equals(a.estado())) && racha.normalDesdeMs() != null
                && ahoraMs - racha.normalDesdeMs() >= resolverTrasMin * 60000L) {
            return new Paso(racha, Decision.de(TipoDecision.RESOLVER));
        }
        if (viva && puedeEscalar(a, ahoraMs, niveles)) {
            int nivel = a.nivel() + 1;
            return new Paso(racha, new Decision(TipoDecision.ESCALAR, nivel, proximoEscala(niveles, nivel, a.primeraVezMs())));
        }
        return new Paso(racha, Decision.de(TipoDecision.NADA));
    }

    private static boolean puedeEscalar(AlertaViva a, long ahoraMs, List<Nivel> niveles) {
        return "ABIERTA".equals(a.estado()) && a.proximoEscalaMs() != null && ahoraMs >= a.proximoEscalaMs() && a.nivel() < niveles.size();
    }

    /** Huella de deduplicación (RN-M7-02). */
    public static String huella(String tipo, int localId, String entidad) {
        return tipo + "|" + localId + "|" + (entidad == null ? "-" : entidad);
    }
}
