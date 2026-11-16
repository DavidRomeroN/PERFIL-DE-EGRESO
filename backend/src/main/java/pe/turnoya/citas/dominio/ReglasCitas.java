package pe.turnoya.citas.dominio;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import pe.turnoya.compartido.tiempo.Fechas;

/** M3 · Reglas puras de citas (docs/modulos/M3-citas-reservas.md §6). Sin E/S. */
public final class ReglasCitas {

    public enum EstadoCita { RESERVADA, CONFIRMADA, CHECKIN, ATENDIDA, NO_SHOW, CANCELADA }

    public static final Set<EstadoCita> ACTIVAS = Set.of(EstadoCita.RESERVADA, EstadoCita.CONFIRMADA);

    /** §6.4 Máquina de estados de la cita. */
    private static final Map<EstadoCita, Set<EstadoCita>> TRANSICIONES = Map.of(
            EstadoCita.RESERVADA, Set.of(EstadoCita.CONFIRMADA, EstadoCita.CHECKIN, EstadoCita.CANCELADA, EstadoCita.NO_SHOW, EstadoCita.ATENDIDA),
            EstadoCita.CONFIRMADA, Set.of(EstadoCita.CHECKIN, EstadoCita.CANCELADA, EstadoCita.NO_SHOW, EstadoCita.ATENDIDA),
            EstadoCita.CHECKIN, Set.of(EstadoCita.ATENDIDA, EstadoCita.NO_SHOW),
            EstadoCita.ATENDIDA, Set.of(),
            EstadoCita.NO_SHOW, Set.of(),
            EstadoCita.CANCELADA, Set.of());

    public static final long VENTANA_PIN_MS = 5 * 60_000L;

    private ReglasCitas() {
    }

    public static boolean transicionValida(EstadoCita desde, EstadoCita hacia) {
        return TRANSICIONES.get(desde).contains(hacia);
    }

    public enum TipoVentana { TEMPRANO, DENTRO, TARDE, VENCIDA }

    public record Ventana(TipoVentana tipo, Instant disponibleDesde) {
    }

    /** §6.5: ventana de check-in (−10/+15 por defecto) y gracia para entrar tarde como turno general. */
    public static Ventana ventanaCheckin(Instant inicio, Instant ahora, int antesMin, int despuesMin, int graciaMin) {
        Instant desde = inicio.minus(Duration.ofMinutes(antesMin));
        Instant hasta = inicio.plus(Duration.ofMinutes(despuesMin));
        Instant gracia = hasta.plus(Duration.ofMinutes(graciaMin));
        if (ahora.isBefore(desde)) {
            return new Ventana(TipoVentana.TEMPRANO, desde);
        }
        if (!ahora.isAfter(hasta)) {
            return new Ventana(TipoVentana.DENTRO, null);
        }
        if (!ahora.isAfter(gracia)) {
            return new Ventana(TipoVentana.TARDE, null);
        }
        return new Ventana(TipoVentana.VENCIDA, null);
    }

    /** RN-M3-05: llegar temprano no adelanta a nadie ⇒ emitido_at = max(ahora, inicio). */
    public static Instant emisionDeCita(Instant inicio, Instant ahora, boolean tarde) {
        return tarde || ahora.isAfter(inicio) ? ahora : inicio;
    }

    /** RF-M3-02: capacidad = capacidadFija ?? max(1, floor(ventanillas × cuota%)). */
    public static int capacidadSlot(int ventanillas, int cuotaPct, Integer capacidadFija) {
        if (capacidadFija != null && capacidadFija > 0) {
            return capacidadFija;
        }
        return Math.max(1, ventanillas * cuotaPct / 100);
    }

    public record Tramo(String apertura, String cierre) {
    }

    public record Rango(Instant inicio, Instant fin) {

        boolean cruza(Instant ini, Instant termino) {
            return ini.isBefore(fin) && termino.isAfter(inicio);
        }
    }

    /** §6.1: franjas del día a partir del horario, menos bloqueos y lo que ya pasó. */
    public static List<Rango> franjasDelDia(LocalDate fecha, List<Tramo> tramos, int duracionMin, ZoneId zona, List<Rango> bloqueos, Instant ahora) {
        List<Rango> salida = new ArrayList<>();
        for (Tramo t : tramos) {
            int ini = Fechas.minutosDe(t.apertura());
            int fin = Fechas.minutosDe(t.cierre());
            for (int m = ini; m + duracionMin <= fin; m += duracionMin) {
                Instant inicio = Fechas.instanteLocal(fecha, m / 60, m % 60, zona);
                Instant termino = inicio.plus(Duration.ofMinutes(duracionMin));
                if (!inicio.isAfter(ahora)) {
                    continue;
                }
                if (bloqueos.stream().anyMatch(b -> b.cruza(inicio, termino))) {
                    continue;
                }
                salida.add(new Rango(inicio, termino));
            }
        }
        salida.sort(Comparator.comparing(Rango::inicio));
        return salida;
    }

    /** RN-M3-02: anticipación mínima y máxima. */
    public static boolean dentroDeAnticipacion(Instant inicio, Instant ahora, int minMin, int maxDias) {
        long dif = inicio.toEpochMilli() - ahora.toEpochMilli();
        return dif >= minMin * 60_000L && dif <= maxDias * 86_400_000L;
    }

    /** RN-M3-06: bloqueo por reincidencia. */
    public static boolean debeBloquear(int noShows90d, int maxNoShow) {
        return maxNoShow > 0 && noShows90d >= maxNoShow;
    }

    // -----------------------------------------------------------------------------------------------------------
    // PIN de presencia (§6.5): HMAC-SHA256(secreto, localId ‖ ventana de 5 min) → 4 dígitos.
    // -----------------------------------------------------------------------------------------------------------

    public static String pinPresencia(String secreto, int localId, long ventana) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secreto.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] h = mac.doFinal((localId + ":" + ventana).getBytes(StandardCharsets.UTF_8));
            int desplazamiento = h[h.length - 1] & 0x0f;
            int n = ByteBuffer.wrap(h, desplazamiento, 4).getInt() & 0x7fffffff;
            return String.format("%04d", n % 10000);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException(e);
        }
    }

    public static long ventanaPin(long ahoraMs) {
        return Math.floorDiv(ahoraMs, VENTANA_PIN_MS);
    }

    /** Acepta el PIN de la ventana actual y el de la anterior (tolerancia de reloj). */
    public static boolean validarPin(String secreto, int localId, String pin, long ahoraMs) {
        long v = ventanaPin(ahoraMs);
        String limpio = pin == null ? "" : pin.trim();
        return pinPresencia(secreto, localId, v).equals(limpio) || pinPresencia(secreto, localId, v - 1).equals(limpio);
    }

    public static int segundosRestantesPin(long ahoraMs) {
        return (int) Math.ceil((VENTANA_PIN_MS - Math.floorMod(ahoraMs, VENTANA_PIN_MS)) / 1000.0);
    }

    // -----------------------------------------------------------------------------------------------------------
    // .ics (§6.8)
    // -----------------------------------------------------------------------------------------------------------

    private static final DateTimeFormatter ICS = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss");

    private static String escaparIcs(String s) {
        return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replaceAll("\\r?\\n", "\\\\n");
    }

    public record DatosIcs(int id, Instant inicio, Instant fin, String local, String servicio, String direccion, String url, ZoneId zona) {
    }

    public static String generarIcs(DatosIcs c, Instant ahora) {
        List<String> l = new ArrayList<>(List.of(
                "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TurnoYa//Citas//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
                "BEGIN:VTIMEZONE", "TZID:" + c.zona().getId(), "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:-0500",
                "TZOFFSETTO:-0500", "TZNAME:-05", "END:STANDARD", "END:VTIMEZONE",
                "BEGIN:VEVENT", "UID:cita-" + c.id() + "@turnoya.pe",
                "DTSTAMP:" + ICS.format(ahora.atOffset(ZoneOffset.UTC)) + "Z",
                "DTSTART;TZID=" + c.zona().getId() + ":" + ICS.format(c.inicio().atZone(c.zona())),
                "DTEND;TZID=" + c.zona().getId() + ":" + ICS.format(c.fin().atZone(c.zona())),
                "SUMMARY:" + escaparIcs("Cita en " + c.local() + " (" + c.servicio() + ")")));
        if (c.direccion() != null && !c.direccion().isBlank()) {
            l.add("LOCATION:" + escaparIcs(c.direccion()));
        }
        l.addAll(List.of("URL:" + c.url(), "DESCRIPTION:" + escaparIcs("Al llegar haz check-in desde " + c.url()),
                "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Recordatorio de tu cita", "END:VALARM",
                "END:VEVENT", "END:VCALENDAR"));
        return String.join("\r\n", l);
    }
}
