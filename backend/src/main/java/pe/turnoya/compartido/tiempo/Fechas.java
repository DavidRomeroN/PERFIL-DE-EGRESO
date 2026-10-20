package pe.turnoya.compartido.tiempo;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/**
 * Fechas en la zona horaria del local. En la BD todo está en UTC; la conversión ocurre solo en el borde.
 * Equivale a {@code backend/src/fechas.ts} de legacy/.
 */
public final class Fechas {

    public static final ZoneId LIMA = ZoneId.of("America/Lima");

    private Fechas() {
    }

    /** Fecha calendario del local en ese instante (la "fecha" de un turno, que reinicia la numeración). */
    public static LocalDate fechaLocal(ZoneId zona, Instant instante) {
        return instante.atZone(zona).toLocalDate();
    }

    /** Día de la semana (0 = domingo, como en la tabla {@code horario_local}), hora y minuto locales. */
    public static PartesLocales partes(ZoneId zona, Instant instante) {
        ZonedDateTime z = instante.atZone(zona);
        return new PartesLocales(diaSemana(z.getDayOfWeek()), z.getHour(), z.getMinute());
    }

    /** Instante UTC que corresponde a {@code fecha hh:mm} en la zona del local. */
    public static Instant instanteLocal(LocalDate fecha, int hora, int minuto, ZoneId zona) {
        return fecha.atTime(hora, minuto).atZone(zona).toInstant();
    }

    /** "HH:MM" → minutos desde la medianoche. */
    public static int minutosDe(String hhmm) {
        LocalTime t = LocalTime.parse(hhmm.length() == 4 ? "0" + hhmm : hhmm);
        return t.getHour() * 60 + t.getMinute();
    }

    public static ZoneId zona(String nombre) {
        return nombre == null || nombre.isBlank() ? LIMA : ZoneId.of(nombre);
    }

    private static int diaSemana(DayOfWeek dia) {
        return dia.getValue() % 7;
    }

    public record PartesLocales(int diaSemana, int hora, int minuto) {
        public int minutosDelDia() {
            return hora * 60 + minuto;
        }
    }
}
