package pe.turnoya.plataforma.infraestructura;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.plataforma.dominio.Horario;
import pe.turnoya.plataforma.dominio.RepositorioHorarios;

/** Acceso a la tabla {@code horario_local}. */
@Repository
class HorariosJdbc implements RepositorioHorarios {

    private final JdbcClient jdbc;

    HorariosJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Horario> activosDe(int localId) {
        return jdbc.sql("SELECT dia_semana, apertura, cierre FROM horario_local WHERE local_id = :local AND activo")
                .param("local", localId)
                .query((rs, i) -> new Horario(rs.getInt("dia_semana"), rs.getString("apertura"), rs.getString("cierre")))
                .list();
    }

    @Override
    public List<HorarioDia> todosDe(int localId) {
        return jdbc.sql("SELECT dia_semana, apertura, cierre, activo FROM horario_local WHERE local_id = :local ORDER BY dia_semana")
                .param("local", localId)
                .query((rs, i) -> new HorarioDia(rs.getInt("dia_semana"), rs.getString("apertura"), rs.getString("cierre"), rs.getBoolean("activo")))
                .list();
    }

    @Override
    public void guardar(int localId, HorarioDia h) {
        jdbc.sql("""
                        INSERT INTO horario_local (local_id, dia_semana, apertura, cierre, activo) VALUES (:local, :dia, :apertura, :cierre, :activo)
                        ON CONFLICT (local_id, dia_semana) DO UPDATE SET apertura = EXCLUDED.apertura, cierre = EXCLUDED.cierre, activo = EXCLUDED.activo""")
                .param("local", localId).param("dia", h.diaSemana()).param("apertura", h.apertura()).param("cierre", h.cierre())
                .param("activo", h.activo())
                .update();
    }
}
