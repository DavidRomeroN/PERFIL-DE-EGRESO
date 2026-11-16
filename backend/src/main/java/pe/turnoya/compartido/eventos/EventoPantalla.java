package pe.turnoya.compartido.eventos;

import java.util.Map;

/**
 * Aviso en tiempo real de un módulo opcional para las pantallas del local ({@code cita:estado}, {@code prediccion:modelo},
 * {@code kiosco:estado}, {@code alerta:nueva}…). El módulo de tiempo real lo reparte tal cual, sin conocer al módulo
 * que lo publica. {@code campos} van al JSON junto a {@code tipo} y {@code localId}, como en el sistema anterior.
 */
public record EventoPantalla(String tipo, int localId, Map<String, Object> campos) {
}
