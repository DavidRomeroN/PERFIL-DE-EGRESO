package pe.turnoya.balanceo.dominio;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import pe.turnoya.balanceo.dominio.Condicion.Alguna;
import pe.turnoya.balanceo.dominio.Condicion.Comparacion;
import pe.turnoya.balanceo.dominio.Condicion.Negacion;
import pe.turnoya.balanceo.dominio.Condicion.Todas;

/** M6 · Reglas puras del balanceo (§6.2–6.5): evaluación, histéresis, validaciones y la máquina de estados por regla. Sin E/S. */
public final class ReglasBalanceo {

    /** RN-M6-07: tope de acciones automáticas ejecutadas por hora y local. */
    public static final int MAX_ACCIONES_HORA = 6;

    private ReglasBalanceo() {
    }

    /** Métricas por cola ({@code colaId → métrica → valor}) y del local. */
    public record MetricasLocal(Map<Integer, Map<String, Double>> colas, double esperaPromLocal) {
    }

    public static Double valor(MetricasLocal m, Comparacion c) {
        if ("espera_prom_local".equals(c.metrica())) {
            return m.esperaPromLocal();
        }
        List<Integer> colas = c.cola() != null ? List.of(c.cola()) : new ArrayList<>(m.colas().keySet());
        // Sin alcance: la peor cola (máximo) para métricas de carga
        return colas.stream().map(id -> m.colas().getOrDefault(id, Map.of()).get(c.metrica())).filter(v -> v != null)
                .max(Comparator.naturalOrder()).orElse(null);
    }

    private static boolean compara(double a, String op, double b) {
        return switch (op) {
            case ">" -> a > b;
            case ">=" -> a >= b;
            case "<" -> a < b;
            case "<=" -> a <= b;
            default -> a == b;
        };
    }

    public static boolean evaluar(Condicion cond, MetricasLocal m) {
        return switch (cond) {
            case Todas t -> t.condiciones().stream().allMatch(c -> evaluar(c, m));
            case Alguna a -> a.condiciones().stream().anyMatch(c -> evaluar(c, m));
            case Negacion n -> !evaluar(n.condicion(), m);
            case Comparacion c -> {
                Double v = valor(m, c);
                yield v != null && compara(v, c.op(), c.valor());
            }
        };
    }

    /**
     * RN-M6-06: condición de salida con histéresis. Para "mayor que" el umbral baja a {@code valor × (1 − h)}; para
     * "menor que" sube a {@code valor × (1 + h)}. Se revierte cuando la condición endurecida ya no se cumple.
     */
    public static Condicion condicionSalida(Condicion cond, int histeresisPct) {
        double h = histeresisPct / 100.0;
        return switch (cond) {
            case Todas t -> new Todas(t.condiciones().stream().map(c -> condicionSalida(c, histeresisPct)).toList());
            case Alguna a -> new Alguna(a.condiciones().stream().map(c -> condicionSalida(c, histeresisPct)).toList());
            case Negacion n -> new Negacion(condicionSalida(n.condicion(), histeresisPct));
            case Comparacion c -> switch (c.op()) {
                case ">", ">=" -> new Comparacion(c.metrica(), c.cola(), c.op(), c.valor() * (1 - h));
                case "<", "<=" -> new Comparacion(c.metrica(), c.cola(), c.op(), c.valor() * (1 + h));
                default -> c;
            };
        };
    }

    /** RN-M6-10: condición imposible ({@code x > a} y {@code x < b} con {@code b ≤ a}) dentro de un mismo {@code all}. */
    public static boolean condicionImposible(Condicion cond) {
        if (cond instanceof Alguna a) {
            return a.condiciones().stream().allMatch(ReglasBalanceo::condicionImposible);
        }
        if (!(cond instanceof Todas t)) {
            return false;
        }
        List<Comparacion> comps = t.condiciones().stream().filter(c -> c instanceof Comparacion).map(c -> (Comparacion) c).toList();
        for (Comparacion a : comps) {
            for (Comparacion b : comps) {
                if (a == b || !a.metrica().equals(b.metrica()) || !java.util.Objects.equals(a.cola(), b.cola())) {
                    continue;
                }
                boolean minimo = a.op().equals(">") || a.op().equals(">=");
                boolean maximo = b.op().equals("<") || b.op().equals("<=");
                if (minimo && maximo && (b.valor() < a.valor() || (b.valor() == a.valor() && (a.op().equals(">") || b.op().equals("<"))))) {
                    return true;
                }
            }
        }
        return t.condiciones().stream().anyMatch(c -> !(c instanceof Comparacion) && condicionImposible(c));
    }

    public record ReglaDef(int id, Accion accion, int forSegundos, int cooldownSeg, boolean activa) {
    }

    /** RN-M6-10: dos reglas que mueven operadores entre las mismas colas en sentido opuesto sin separación suficiente. */
    public static Integer reglasContradictorias(ReglaDef nueva, List<ReglaDef> otras) {
        if (!(nueva.accion() instanceof Accion.MoverOperador n)) {
            return null;
        }
        for (ReglaDef o : otras) {
            if (!o.activa() || o.id() == nueva.id() || !(o.accion() instanceof Accion.MoverOperador a)) {
                continue;
            }
            if (a.desdeColaId() == n.haciaColaId() && a.haciaColaId() == n.desdeColaId()
                    && Math.min(nueva.cooldownSeg(), o.cooldownSeg()) < 2 * Math.max(nueva.forSegundos(), o.forSegundos())) {
                return o.id();
            }
        }
        return null;
    }

    // --- §6.4 Evaluador: máquina de estados por regla ---

    public enum Fase { INACTIVA, ARMADA, ACTIVA }

    public enum Decision { NADA, EJECUTAR, REVERTIR, OMITIDA_COOLDOWN }

    public record EstadoRegla(Fase fase, Long verdaderaDesdeMs, Long falsaDesdeMs, Long ultimaEjecucionMs, Long ejecutadaMs) {

        public static final EstadoRegla INICIAL = new EstadoRegla(Fase.INACTIVA, null, null, null, null);
    }

    public record ConfigEvaluador(int forSegundos, int forSegundosReversa, int cooldownSeg, Integer ttlSeg, boolean reversible) {
    }

    public record Paso(EstadoRegla estado, Decision decision) {
    }

    /**
     * {@code cond} = la condición de disparo; {@code salida} = la condición endurecida con histéresis (verdadera mientras
     * haga falta mantener la acción). El límite por hora y la exclusión mutua los revisa el orquestador.
     */
    public static Paso avanzar(EstadoRegla e, boolean cond, boolean salida, long ahoraMs, ConfigEvaluador cfg) {
        if (e.fase() == Fase.INACTIVA) {
            if (!cond) {
                return new Paso(new EstadoRegla(e.fase(), null, e.falsaDesdeMs(), e.ultimaEjecucionMs(), e.ejecutadaMs()), Decision.NADA);
            }
            EstadoRegla armada = new EstadoRegla(Fase.ARMADA, ahoraMs, null, e.ultimaEjecucionMs(), e.ejecutadaMs());
            return cfg.forSegundos() <= 0 ? avanzar(armada, cond, salida, ahoraMs, cfg) : new Paso(armada, Decision.NADA);
        }
        if (e.fase() == Fase.ARMADA) {
            // Un parpadeo de la condición reinicia el armado (RN-M6-04)
            if (!cond) {
                return new Paso(new EstadoRegla(Fase.INACTIVA, null, e.falsaDesdeMs(), e.ultimaEjecucionMs(), e.ejecutadaMs()), Decision.NADA);
            }
            long desde = e.verdaderaDesdeMs() == null ? ahoraMs : e.verdaderaDesdeMs();
            if (ahoraMs - desde < cfg.forSegundos() * 1000L) {
                return new Paso(e, Decision.NADA);
            }
            if (e.ultimaEjecucionMs() != null && ahoraMs - e.ultimaEjecucionMs() < cfg.cooldownSeg() * 1000L) {
                return new Paso(e, Decision.OMITIDA_COOLDOWN);
            }
            Fase fase = cfg.reversible() ? Fase.ACTIVA : Fase.INACTIVA;
            return new Paso(new EstadoRegla(fase, null, null, ahoraMs, ahoraMs), Decision.EJECUTAR);
        }
        // ACTIVA: revertir si la salida con histéresis deja de cumplirse sostenidamente, o si vence el TTL
        if (cfg.ttlSeg() != null && cfg.ttlSeg() > 0 && e.ejecutadaMs() != null && ahoraMs - e.ejecutadaMs() >= cfg.ttlSeg() * 1000L) {
            return new Paso(new EstadoRegla(Fase.INACTIVA, e.verdaderaDesdeMs(), null, e.ultimaEjecucionMs(), null), Decision.REVERTIR);
        }
        if (salida) {
            return new Paso(new EstadoRegla(e.fase(), e.verdaderaDesdeMs(), null, e.ultimaEjecucionMs(), e.ejecutadaMs()), Decision.NADA);
        }
        long falsaDesde = e.falsaDesdeMs() == null ? ahoraMs : e.falsaDesdeMs();
        if (ahoraMs - falsaDesde >= cfg.forSegundosReversa() * 1000L) {
            return new Paso(new EstadoRegla(Fase.INACTIVA, e.verdaderaDesdeMs(), null, e.ultimaEjecucionMs(), null), Decision.REVERTIR);
        }
        return new Paso(new EstadoRegla(e.fase(), e.verdaderaDesdeMs(), falsaDesde, e.ultimaEjecucionMs(), e.ejecutadaMs()), Decision.NADA);
    }

    /** Descripción legible para el modo simulación ("habría movido…"). */
    public static String describirAccion(Accion a, Map<Integer, String> nombres, Map<Integer, String> ventanillas) {
        java.util.function.IntFunction<String> n = id -> nombres.getOrDefault(id, "#" + id);
        return switch (a) {
            case Accion.AbrirVentanilla x -> "abrir la ventanilla " + ventanillas.getOrDefault(x.ventanillaId(), "#" + x.ventanillaId());
            case Accion.MoverOperador x -> "mover una ventanilla de " + n.apply(x.desdeColaId()) + " a " + n.apply(x.haciaColaId());
            case Accion.DerivarTurnos x -> "derivar " + x.cantidad() + " turnos de " + n.apply(x.deColaId()) + " a " + n.apply(x.aColaId());
            case Accion.Notificar x -> "avisar: \"" + x.mensaje() + "\"";
            case Accion.AjustarAlfa x -> (x.delta() > 0 ? "dar más peso" : "dar menos peso") + " al tiempo de espera en las prioridades";
        };
    }

    public static boolean esReversible(Accion a) {
        return a instanceof Accion.AbrirVentanilla || a instanceof Accion.MoverOperador || a instanceof Accion.AjustarAlfa;
    }

    public record CargaCola(int colaId, int enEspera, int ventanillas) {
    }

    public record Movimiento(int desde, int hacia, int diferencia) {
    }

    /** Sugerencia simple (botón "Balancear ahora"): mover de la cola más vacía a la más llena. */
    public static Movimiento sugerirMovimiento(List<CargaCola> cargas, int umbral) {
        if (cargas.size() < 2) {
            return null;
        }
        List<CargaCola> orden = cargas.stream().sorted(Comparator.comparingInt(CargaCola::enEspera).reversed()).toList();
        CargaCola llena = orden.getFirst();
        CargaCola vacia = orden.getLast();
        if (vacia.ventanillas() < 2 || llena.enEspera() - vacia.enEspera() < umbral) {
            return null;
        }
        return new Movimiento(vacia.colaId(), llena.colaId(), llena.enEspera() - vacia.enEspera());
    }
}
