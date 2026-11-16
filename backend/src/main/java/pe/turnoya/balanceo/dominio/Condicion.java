package pe.turnoya.balanceo.dominio;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Condición de una regla de balanceo: una comparación de una métrica contra un umbral, o la composición
 * {@code all} / {@code any} / {@code not}. Se guarda como JSON en {@code regla_balanceo.condicion} con el mismo formato
 * del sistema anterior: {@code {"metric":"espera_prom_min","scope":{"cola":3},"op":">","value":20}}.
 */
public sealed interface Condicion {

    Set<String> METRICAS = Set.of("en_espera", "espera_max_min", "espera_prom_min", "ventanillas_operativas", "ventanillas_libres", "utilizacion",
            "tasa_llegada_15m", "sla_cumplimiento", "espera_prom_local");
    Set<String> OPERADORES = Set.of(">", ">=", "<", "<=", "==");

    /** {@code cola} nulo = sin alcance (se toma la peor cola). */
    record Comparacion(String metrica, Integer cola, String op, double valor) implements Condicion {
    }

    record Todas(List<Condicion> condiciones) implements Condicion {
    }

    record Alguna(List<Condicion> condiciones) implements Condicion {
    }

    record Negacion(Condicion condicion) implements Condicion {
    }

    /** Lee el árbol (mapas, listas y números como los entrega el parser JSON). Lanza {@link IllegalArgumentException} si no es válida. */
    static Condicion desde(Object nodo) {
        return desde(nodo, 0);
    }

    private static Condicion desde(Object nodo, int profundidad) {
        if (profundidad > 6 || !(nodo instanceof Map<?, ?> m)) {
            throw new IllegalArgumentException("condición");
        }
        if (m.containsKey("all")) {
            return new Todas(lista(m.get("all"), profundidad));
        }
        if (m.containsKey("any")) {
            return new Alguna(lista(m.get("any"), profundidad));
        }
        if (m.containsKey("not")) {
            return new Negacion(desde(m.get("not"), profundidad + 1));
        }
        if (!(m.get("metric") instanceof String metrica) || !METRICAS.contains(metrica)) {
            throw new IllegalArgumentException("métrica");
        }
        if (!(m.get("op") instanceof String op) || !OPERADORES.contains(op)) {
            throw new IllegalArgumentException("operador");
        }
        if (!(m.get("value") instanceof Number valor) || !Double.isFinite(valor.doubleValue())) {
            throw new IllegalArgumentException("valor");
        }
        Integer cola = null;
        if (m.get("scope") instanceof Map<?, ?> alcance && alcance.get("cola") != null) {
            if (!(alcance.get("cola") instanceof Number n) || n.intValue() <= 0) {
                throw new IllegalArgumentException("alcance");
            }
            cola = n.intValue();
        }
        return new Comparacion(metrica, cola, op, valor.doubleValue());
    }

    private static List<Condicion> lista(Object nodo, int profundidad) {
        if (!(nodo instanceof List<?> l) || l.isEmpty() || l.size() > 10) {
            throw new IllegalArgumentException("lista");
        }
        return l.stream().map(x -> desde(x, profundidad + 1)).toList();
    }

    /** Árbol para guardar como JSON. */
    default Object aArbol() {
        return switch (this) {
            case Todas t -> Map.of("all", t.condiciones().stream().map(Condicion::aArbol).toList());
            case Alguna a -> Map.of("any", a.condiciones().stream().map(Condicion::aArbol).toList());
            case Negacion n -> Map.of("not", n.condicion().aArbol());
            case Comparacion c -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("metric", c.metrica());
                if (c.cola() != null) {
                    m.put("scope", Map.of("cola", c.cola()));
                }
                m.put("op", c.op());
                m.put("value", c.valor());
                yield m;
            }
        };
    }

    /** Colas que la condición menciona en su alcance. */
    default List<Integer> colas() {
        return switch (this) {
            case Todas t -> t.condiciones().stream().flatMap(c -> c.colas().stream()).toList();
            case Alguna a -> a.condiciones().stream().flatMap(c -> c.colas().stream()).toList();
            case Negacion n -> n.condicion().colas();
            case Comparacion c -> c.cola() == null ? List.of() : List.of(c.cola());
        };
    }
}
