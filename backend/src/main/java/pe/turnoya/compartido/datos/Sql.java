package pe.turnoya.compartido.datos;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

/**
 * Conversión de fechas con la BD.
 *
 * <p>Las columnas {@code TIMESTAMP(3)} (sin zona) guardan la hora UTC: se leen como {@link LocalDateTime} y se
 * interpretan en UTC, y al escribir se pasa el {@link LocalDateTime} UTC. Nunca usar la zona por defecto de la JVM.
 */
public final class Sql {

    private Sql() {
    }

    /** Parámetro para una columna {@code TIMESTAMP} sin zona. */
    public static LocalDateTime utc(Instant instante) {
        return instante == null ? null : LocalDateTime.ofInstant(instante, ZoneOffset.UTC);
    }

    public static Instant instante(ResultSet rs, String columna) throws SQLException {
        LocalDateTime ldt = rs.getObject(columna, LocalDateTime.class);
        return ldt == null ? null : ldt.toInstant(ZoneOffset.UTC);
    }

    public static LocalDate fecha(ResultSet rs, String columna) throws SQLException {
        return rs.getObject(columna, LocalDate.class);
    }

    public static Integer entero(ResultSet rs, String columna) throws SQLException {
        int v = rs.getInt(columna);
        return rs.wasNull() ? null : v;
    }

    public static Boolean booleano(ResultSet rs, String columna) throws SQLException {
        boolean v = rs.getBoolean(columna);
        return rs.wasNull() ? null : v;
    }

    /** Para columnas {@code TIMESTAMPTZ} (pocas: idempotencia, algunas de módulos). */
    public static Timestamp tz(Instant instante) {
        return instante == null ? null : Timestamp.from(instante);
    }
}
