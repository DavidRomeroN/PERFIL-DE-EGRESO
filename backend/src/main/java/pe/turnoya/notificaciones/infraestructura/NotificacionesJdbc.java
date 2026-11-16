package pe.turnoya.notificaciones.infraestructura;

import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.nucleo.puertos.AvisosDelTurno.AvisoEnviado;
import pe.turnoya.notificaciones.dominio.RepositorioNotificaciones;

/** Acceso a la tabla {@code notificacion}. */
@Repository
class NotificacionesJdbc implements RepositorioNotificaciones {

    private final JdbcClient jdbc;

    NotificacionesJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Avisos por WhatsApp del mes que cuentan para el cupo del plan (los mensajes del antiguo chatbot no cuentan). */
    @Override
    public int usadosDesde(int localId, Instant inicioMes) {
        return jdbc.sql("""
                        SELECT COUNT(*) FROM notificacion
                         WHERE local_id = :local AND tipo = 'WHATSAPP' AND estado <> 'FALLIDO' AND created_at >= :desde
                           AND plantilla <> 'bot'""")
                .param("local", localId).param("desde", Sql.utc(inicioMes)).query(Integer.class).single();
    }

    @Override
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

    @Override
    public void marcarEnviado(int id, String proveedorMsgId, Instant ahora) {
        jdbc.sql("UPDATE notificacion SET estado = 'ENVIADO', proveedor_msg_id = :msg, enviado_at = :ahora WHERE id = :id")
                .param("msg", proveedorMsgId).param("ahora", Sql.utc(ahora)).param("id", id).update();
    }

    @Override
    public void marcarFallido(int id, String error) {
        jdbc.sql("UPDATE notificacion SET estado = 'FALLIDO', error = :error WHERE id = :id")
                .param("error", error == null ? null : error.substring(0, Math.min(500, error.length()))).param("id", id).update();
    }

    @Override
    public void cambiarEstado(int id, String estado) {
        jdbc.sql("UPDATE notificacion SET estado = CAST(:estado AS \"EstadoNotificacion\") WHERE id = :id")
                .param("estado", estado).param("id", id).update();
    }

    @Override
    public List<AvisoEnviado> deTurno(int turnoId) {
        return jdbc.sql("""
                        SELECT id, tipo::text AS tipo, destino, mensaje, estado::text AS estado, enviado_at, created_at
                          FROM notificacion WHERE turno_id = :turno ORDER BY created_at""")
                .param("turno", turnoId)
                .query((rs, i) -> new AvisoEnviado(rs.getInt("id"), rs.getString("tipo"), rs.getString("destino"), rs.getString("mensaje"),
                        rs.getString("estado"), Sql.instante(rs, "enviado_at"), Sql.instante(rs, "created_at")))
                .list();
    }

    @Override
    public List<AvisoBandeja> bandeja(int localId, int limite) {
        return jdbc.sql("""
                        SELECT n.id, n.tipo::text AS tipo, n.destino, n.mensaje, n.plantilla, n.estado::text AS estado, n.error, n.created_at,
                               t.codigo, c.nombre AS cola, cl.nombre AS cliente
                          FROM notificacion n
                          LEFT JOIN turno t ON t.id = n.turno_id
                          LEFT JOIN cola c ON c.id = t.cola_id
                          LEFT JOIN cliente cl ON cl.id = t.cliente_id
                         WHERE n.local_id = :local
                         ORDER BY n.created_at DESC LIMIT :limite""")
                .param("local", localId).param("limite", limite)
                .query((rs, i) -> new AvisoBandeja(rs.getInt("id"), rs.getString("tipo"), rs.getString("destino"), rs.getString("mensaje"),
                        rs.getString("plantilla"), rs.getString("estado"), rs.getString("error"), Sql.instante(rs, "created_at"),
                        rs.getString("codigo"), rs.getString("cola"), rs.getString("cliente")))
                .list();
    }

    @Override
    public java.util.Map<String, Integer> resumenWhatsApp(int localId) {
        java.util.Map<String, Integer> resumen = new java.util.LinkedHashMap<>();
        jdbc.sql("SELECT estado::text AS estado, count(*) AS n FROM notificacion WHERE local_id = :local AND tipo = 'WHATSAPP' GROUP BY estado")
                .param("local", localId)
                .query((rs, i) -> resumen.put(rs.getString("estado"), rs.getInt("n")))
                .list();
        return resumen;
    }
}
