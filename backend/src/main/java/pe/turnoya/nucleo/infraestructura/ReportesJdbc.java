package pe.turnoya.nucleo.infraestructura;

import java.time.LocalDate;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.nucleo.CanalTurno;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.dominio.RepositorioReportes;

/** Consulta de turnos por rango de fechas para los reportes (RF09) y el dashboard. */
@Repository
class ReportesJdbc implements RepositorioReportes {

    private final JdbcClient jdbc;

    ReportesJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<FilaReporte> turnosDelRango(int localId, LocalDate desde, LocalDate hasta) {
        return jdbc.sql("""
                        SELECT t.id, t.fecha, COALESCE(t.codigo, t.codigo_provisional) AS codigo, t.cola_id, c.nombre AS cola, c.prefijo,
                               t.estado::text AS estado, t.canal::text AS canal, v.nombre AS ventanilla,
                               t.emitido_at, t.llamado_at, t.finalizado_at
                          FROM turno t
                          JOIN cola c ON c.id = t.cola_id
                          LEFT JOIN ventanilla v ON v.id = t.ventanilla_id
                         WHERE t.local_id = :local AND t.fecha BETWEEN :desde AND :hasta AND t.estado <> 'TRANSFERIDO'
                         ORDER BY t.emitido_at, t.id""")
                .param("local", localId).param("desde", desde).param("hasta", hasta)
                .query((rs, i) -> new FilaReporte(rs.getInt("id"), Sql.fecha(rs, "fecha"), rs.getString("codigo"), rs.getInt("cola_id"),
                        rs.getString("cola"), rs.getString("prefijo"), EstadoTurno.valueOf(rs.getString("estado")),
                        CanalTurno.valueOf(rs.getString("canal")), rs.getString("ventanilla"), Sql.instante(rs, "emitido_at"),
                        Sql.instante(rs, "llamado_at"), Sql.instante(rs, "finalizado_at")))
                .list();
    }
}
