package pe.turnoya.balanceo.dominio;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Acción de una regla de balanceo; se guarda como JSON en {@code regla_balanceo.accion} con el campo {@code tipo}. */
public sealed interface Accion {

    /** Activa una ventanilla (y opcionalmente la asigna a una cola). Reversible. */
    record AbrirVentanilla(int ventanillaId, Integer colaId) implements Accion {
    }

    /** Mueve una ventanilla libre de una cola a otra. Reversible. */
    record MoverOperador(int desdeColaId, int haciaColaId, Integer ventanillaId) implements Accion {
    }

    /** Transfiere los últimos {@code cantidad} turnos en espera a otra cola (conservan su lugar). */
    record DerivarTurnos(int deColaId, int aColaId, int cantidad) implements Accion {
    }

    record Notificar(String mensaje) implements Accion {
    }

    /** Cambia el α (puntos por minuto de espera) de las prioridades de M1. Reversible. */
    record AjustarAlfa(double delta) implements Accion {
    }

    static Accion desde(Object nodo) {
        if (!(nodo instanceof Map<?, ?> m) || !(m.get("tipo") instanceof String tipo)) {
            throw new IllegalArgumentException("acción");
        }
        return switch (tipo) {
            case "ABRIR_VENTANILLA" -> new AbrirVentanilla(positivo(m, "ventanillaId"), opcional(m, "colaId"));
            case "MOVER_OPERADOR" -> new MoverOperador(positivo(m, "desdeColaId"), positivo(m, "haciaColaId"), opcional(m, "ventanillaId"));
            case "DERIVAR_TURNOS" -> {
                int cantidad = positivo(m, "cantidad");
                if (cantidad > 20) {
                    throw new IllegalArgumentException("cantidad");
                }
                yield new DerivarTurnos(positivo(m, "deColaId"), positivo(m, "aColaId"), cantidad);
            }
            case "NOTIFICAR" -> {
                if (!(m.get("mensaje") instanceof String msj) || msj.length() < 3 || msj.length() > 200) {
                    throw new IllegalArgumentException("mensaje");
                }
                yield new Notificar(msj);
            }
            case "AJUSTAR_ALFA" -> {
                if (!(m.get("delta") instanceof Number d) || d.doubleValue() < -2 || d.doubleValue() > 2) {
                    throw new IllegalArgumentException("delta");
                }
                yield new AjustarAlfa(d.doubleValue());
            }
            default -> throw new IllegalArgumentException("tipo");
        };
    }

    private static int positivo(Map<?, ?> m, String campo) {
        if (!(m.get(campo) instanceof Number n) || n.doubleValue() != Math.floor(n.doubleValue()) || n.intValue() <= 0) {
            throw new IllegalArgumentException(campo);
        }
        return n.intValue();
    }

    private static Integer opcional(Map<?, ?> m, String campo) {
        return m.get(campo) == null ? null : positivo(m, campo);
    }

    default String tipo() {
        return switch (this) {
            case AbrirVentanilla a -> "ABRIR_VENTANILLA";
            case MoverOperador a -> "MOVER_OPERADOR";
            case DerivarTurnos a -> "DERIVAR_TURNOS";
            case Notificar a -> "NOTIFICAR";
            case AjustarAlfa a -> "AJUSTAR_ALFA";
        };
    }

    default Map<String, Object> aArbol() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("tipo", tipo());
        switch (this) {
            case AbrirVentanilla a -> {
                m.put("ventanillaId", a.ventanillaId());
                if (a.colaId() != null) {
                    m.put("colaId", a.colaId());
                }
            }
            case MoverOperador a -> {
                m.put("desdeColaId", a.desdeColaId());
                m.put("haciaColaId", a.haciaColaId());
                if (a.ventanillaId() != null) {
                    m.put("ventanillaId", a.ventanillaId());
                }
            }
            case DerivarTurnos a -> {
                m.put("deColaId", a.deColaId());
                m.put("aColaId", a.aColaId());
                m.put("cantidad", a.cantidad());
            }
            case Notificar a -> m.put("mensaje", a.mensaje());
            case AjustarAlfa a -> m.put("delta", a.delta());
        }
        return m;
    }

    /** Colas que usa la acción. */
    default List<Integer> colas() {
        return switch (this) {
            case MoverOperador a -> List.of(a.desdeColaId(), a.haciaColaId());
            case DerivarTurnos a -> List.of(a.deColaId(), a.aColaId());
            case AbrirVentanilla a -> a.colaId() == null ? List.of() : List.of(a.colaId());
            default -> List.of();
        };
    }

    /** Ventanilla que usa la acción (si nombra una). */
    default Integer ventanilla() {
        return switch (this) {
            case AbrirVentanilla a -> a.ventanillaId();
            case MoverOperador a -> a.ventanillaId();
            default -> null;
        };
    }
}
