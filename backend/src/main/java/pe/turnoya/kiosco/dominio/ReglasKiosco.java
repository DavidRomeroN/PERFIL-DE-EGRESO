package pe.turnoya.kiosco.dominio;

/** M5 · Reglas puras del kiosco offline-first (§6.4, RN-M5-03/04/07). */
public final class ReglasKiosco {

    private ReglasKiosco() {
    }

    public static final int MAX_DISPOSITIVOS = 3;

    /** Desfase que se considera "reloj desfasado" en el admin (2 min). */
    public static final long DESFASE_ALERTA_MS = 120_000;

    /** Sin latido en este tiempo el kiosco se considera sin conexión. */
    public static final long SIN_LATIDO_MS = 75_000;

    public enum Motivo { FECHA_ANTERIOR, VENTANA_OFFLINE, RELOJ_INCONSISTENTE }

    /**
     * emitido = ts_dispositivo + offset, nunca en el futuro y monótono dentro del dispositivo (RN-M5-03). La antigüedad
     * máxima la controla {@link #validarEvento}.
     */
    public static long corregirTiempo(long tsDispositivoMs, long offsetMs, Long previoMs, long ahoraMs) {
        long t = Math.min(tsDispositivoMs + offsetMs, ahoraMs);
        if (previoMs != null) {
            t = Math.max(t, previoMs + 1);
        }
        return Math.min(t, ahoraMs);
    }

    /** @return el motivo para mandar el evento a revisión, o {@code null} si es válido. */
    public static Motivo validarEvento(String fechaEventoIso, String hoyIso, long tsCorregidoMs, long ahoraMs, int ventanaOfflineHoras,
                                       long offsetAlEmitirMs, long offsetActualMs) {
        if (fechaEventoIso.compareTo(hoyIso) < 0) {
            return Motivo.FECHA_ANTERIOR;
        }
        if (ahoraMs - tsCorregidoMs > ventanaOfflineHoras * 3_600_000L) {
            return Motivo.VENTANA_OFFLINE;
        }
        if (Math.abs(offsetActualMs - offsetAlEmitirMs) > 300_000) {
            return Motivo.RELOJ_INCONSISTENTE;
        }
        return null;
    }

    /** Código provisional del ticket offline: K{n}-{seq}. */
    public static String codigoProvisional(int numeroDispositivo, int seq) {
        return "K" + numeroDispositivo + "-" + String.format("%04d", seq);
    }

    /** Claves de idempotencia: UUID (v7 desde el kiosco) u otro identificador hexadecimal con guiones. */
    public static boolean claveValida(String clave) {
        return clave != null && clave.matches("(?i)[0-9a-f-]{20,64}");
    }
}
