package pe.turnoya.nucleo.puertos;

/**
 * Espera estimada (RN02). La implementación por defecto usa la función SQL {@code tiempo_estimado}
 * (posición × promedio de los últimos 10 atendidos); M2 la reemplaza con su modelo cuando está activo.
 */
public interface EstimadorEspera {

    boolean aplica(int localId);

    /** Espera para quien quedaría en {@code posicion} (1 = el siguiente en ser llamado). */
    Estimacion estimar(int colaId, int posicion);

    /** {@code rango} solo lo da M2 (p10–p90 con su confianza). */
    record Estimacion(int segundos, Rango rango) {

        public static Estimacion de(int segundos) {
            return new Estimacion(segundos, null);
        }
    }

    record Rango(int loSeg, int hiSeg, double confianza, String modelo, boolean enFrio) {
    }
}
