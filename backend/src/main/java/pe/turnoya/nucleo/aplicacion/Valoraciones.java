package pe.turnoya.nucleo.aplicacion;

import java.time.Instant;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc;

/** N07: el cliente valora la atención (1 a 5 estrellas), una sola vez por turno atendido. */
@Service
public class Valoraciones {

    private final TurnosJdbc turnos;
    private final JdbcClient jdbc;

    Valoraciones(TurnosJdbc turnos, JdbcClient jdbc) {
        this.turnos = turnos;
        this.jdbc = jdbc;
    }

    @Transactional
    public Valoracion valorar(String token, int estrellas, String comentario) {
        Turno t = turnos.porToken(token).filter(x -> x.estado() == EstadoTurno.ATENDIDO)
                .orElseThrow(() -> ErrorNegocio.conflicto("VALIDACION", "Solo se valora un turno ya atendido"));
        boolean existe = jdbc.sql("SELECT EXISTS (SELECT 1 FROM valoracion WHERE turno_id = :id)").param("id", t.id())
                .query(Boolean.class).single();
        if (existe) {
            throw ErrorNegocio.conflicto("M7_VALORACION_DUPLICADA", "Este turno ya fue valorado");
        }
        String limpio = limpiar(comentario);
        return jdbc.sql("INSERT INTO valoracion (turno_id, estrellas, comentario) VALUES (:id, :estrellas, :comentario) RETURNING id, created_at")
                .param("id", t.id()).param("estrellas", estrellas).param("comentario", limpio)
                .query((rs, i) -> new Valoracion(rs.getInt("id"), t.id(), estrellas, limpio, Sql.instante(rs, "created_at")))
                .single();
    }

    @Transactional(readOnly = true)
    public boolean existe(int turnoId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM valoracion WHERE turno_id = :id)").param("id", turnoId).query(Boolean.class).single();
    }

    /** Sin caracteres de control ni etiquetas, máximo 280 caracteres. */
    static String limpiar(String comentario) {
        if (comentario == null) {
            return null;
        }
        String s = comentario.replaceAll("[\\u0000-\\u001f<>]", " ").trim();
        if (s.isEmpty()) {
            return null;
        }
        return s.length() > 280 ? s.substring(0, 280) : s;
    }

    public record Valoracion(int id, int turnoId, int estrellas, String comentario, Instant createdAt) {
    }
}
