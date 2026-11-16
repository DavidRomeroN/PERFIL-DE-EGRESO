package pe.turnoya.plataforma.infraestructura;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import pe.turnoya.compartido.datos.Sql;
import org.springframework.stereotype.Repository;
import pe.turnoya.plataforma.Auditoria.Actor;
import pe.turnoya.plataforma.dominio.RepositorioAuditoria;

/** Acceso a la tabla {@code auditoria} y a las variables de transacción que lee el trigger {@code fn_auditoria()}. */
@Repository
class AuditoriaJdbc implements RepositorioAuditoria {

    private final JdbcClient jdbc;

    AuditoriaJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void fijarActor(Actor actor) {
        jdbc.sql("SELECT set_config('app.usuario_id', :usuario, true), set_config('app.request_id', :request, true), set_config('app.ip', :ip, true)")
                .param("usuario", actor.usuarioId() == null ? "" : String.valueOf(actor.usuarioId()))
                .param("request", actor.requestId() == null ? "" : actor.requestId())
                .param("ip", actor.ip() == null ? "" : actor.ip())
                .query((rs, i) -> 1)
                .list();
    }

    @Override
    public void registrar(Actor actor, Integer localId, String accion, String entidad, String entidadId, String datosJson, String humana) {
        jdbc.sql("""
                        INSERT INTO auditoria (local_id, usuario_id, accion, entidad, entidad_id, datos_json, ip, request_id, accion_humana)
                        VALUES (:local, :usuario, :accion, :entidad, :entidadId, CAST(:datos AS jsonb), :ip, :request, :humana)""")
                .param("local", localId)
                .param("usuario", actor.usuarioId())
                .param("accion", accion)
                .param("entidad", entidad)
                .param("entidadId", entidadId)
                .param("datos", datosJson)
                .param("ip", actor.ip())
                .param("request", actor.requestId())
                .param("humana", humana)
                .update();
    }

    @Override
    public List<FilaAuditoria> consultar(int localId, FiltroAuditoria f, int limite) {
        StringBuilder sql = new StringBuilder("""
                SELECT a.id, a.created_at, a.accion, a.entidad, a.entidad_id, a.accion_humana, a.ip, a.request_id, a.datos_json::text AS datos,
                       u.nombre AS usuario_nombre, u.email AS usuario_email
                FROM auditoria a LEFT JOIN usuario u ON u.id = a.usuario_id
                WHERE a.local_id = :local""");
        var consulta = new java.util.LinkedHashMap<String, Object>();
        consulta.put("local", localId);
        if (f.desde() != null) {
            sql.append(" AND a.created_at >= :desde");
            consulta.put("desde", Sql.utc(f.desde()));
        }
        if (f.hasta() != null) {
            sql.append(" AND a.created_at < :hasta");
            consulta.put("hasta", Sql.utc(f.hasta()));
        }
        if (f.accion() != null) {
            sql.append(" AND a.accion ILIKE :accion");
            consulta.put("accion", "%" + f.accion() + "%");
        }
        if (f.entidad() != null) {
            sql.append(" AND a.entidad = :entidad");
            consulta.put("entidad", f.entidad());
        }
        if (f.texto() != null) {
            sql.append(" AND a.accion_humana ILIKE :texto");
            consulta.put("texto", "%" + f.texto() + "%");
        }
        if (f.requestId() != null) {
            sql.append(" AND a.request_id = :request");
            consulta.put("request", f.requestId());
        }
        if (f.cursor() != null) {
            sql.append(" AND a.id < :cursor");
            consulta.put("cursor", f.cursor());
        }
        sql.append(" ORDER BY a.id DESC LIMIT :limite");
        consulta.put("limite", limite);
        return jdbc.sql(sql.toString()).params(consulta).query((rs, i) -> new FilaAuditoria(rs.getLong("id"), Sql.instante(rs, "created_at"),
                rs.getString("accion"), rs.getString("entidad"), rs.getString("entidad_id"), rs.getString("accion_humana"), rs.getString("ip"),
                rs.getString("request_id"), rs.getString("datos"), rs.getString("usuario_nombre"), rs.getString("usuario_email"))).list();
    }
}
