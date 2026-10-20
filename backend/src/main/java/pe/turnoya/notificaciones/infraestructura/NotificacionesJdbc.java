package pe.turnoya.notificaciones.infraestructura;

import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.nucleo.puertos.AvisosDelTurno.AvisoEnviado;

/** Acceso a la tabla {@code notificacion}. */
@Repository
public class NotificacionesJdbc {

    private final JdbcClient jdbc;

    public NotificacionesJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Avisos por WhatsApp del mes que cuentan para el cupo del plan (los del bot no cuentan, RN-M4-08). */
    public int usadosDesde(int localId, Instant inicioMes) {
        return jdbc.sql("""
                        SELECT COUNT(*) FROM notificacion
                         WHERE local_id = :local AND tipo = 'WHATSAPP' AND estado <> 'FALLIDO' AND created_at >= :desde
                           AND plantilla <> 'bot'""")
                .param("local", localId).param("desde", Sql.utc(inicioMes)).query(Integer.class).single();
    }

    public int registrar(int localId, Integer turnoId, Integer citaId, String tipo, String destino, String mensaje, String plantilla,
                         String estado, Instant enviadoAt, String error) {
        return jdbc.sql("""
                        INSERT INTO notificacion (local_id, turno_id, cita_id, tipo, destino, mensaje, plantilla, estado, enviado_at, error)
                        VALUES (:local, :turno, :cita, CAST(:tipo AS "TipoNotificacion"), :destino, :mensaje, :plantilla,
                                CAST(:estado AS "EstadoNotificacion"), :enviado, :error)
                        RETURNING id""")
                .param("local", localId).param("turno", turnoId).param("cita", citaId).param("tipo", tipo).param("destino", destino)
                .param("mensaje", mensaje).param("plantilla", plantilla).param("estado", estado).param("enviado", Sql.utc(enviadoAt))
                .param("error", error)
                .query(Integer.class).single();
    }

    public void marcarEnviado(int id, String proveedorMsgId, Instant ahora) {
        jdbc.sql("UPDATE notificacion SET estado = 'ENVIADO', proveedor_msg_id = :msg, enviado_at = :ahora WHERE id = :id")
                .param("msg", proveedorMsgId).param("ahora", Sql.utc(ahora)).param("id", id).update();
    }

    public void marcarFallido(int id, String error) {
        jdbc.sql("UPDATE notificacion SET estado = 'FALLIDO', error = :error WHERE id = :id")
                .param("error", error == null ? null : error.substring(0, Math.min(500, error.length()))).param("id", id).update();
    }

    public void cambiarEstado(int id, String estado) {
        jdbc.sql("UPDATE notificacion SET estado = CAST(:estado AS \"EstadoNotificacion\") WHERE id = :id")
                .param("estado", estado).param("id", id).update();
    }

    public List<AvisoEnviado> deTurno(int turnoId) {
        return jdbc.sql("""
                        SELECT id, tipo::text AS tipo, destino, mensaje, estado::text AS estado, enviado_at, created_at
                          FROM notificacion WHERE turno_id = :turno ORDER BY created_at""")
                .param("turno", turnoId)
                .query((rs, i) -> new AvisoEnviado(rs.getInt("id"), rs.getString("tipo"), rs.getString("destino"), rs.getString("mensaje"),
                        rs.getString("estado"), Sql.instante(rs, "enviado_at"), Sql.instante(rs, "created_at")))
                .list();
    }
}
