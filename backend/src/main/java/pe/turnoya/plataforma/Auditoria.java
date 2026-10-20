package pe.turnoya.plataforma;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.web.FiltroIdPeticion;
import pe.turnoya.compartido.web.IpCliente;
import tools.jackson.databind.ObjectMapper;

/**
 * Auditoría (ADR-06).
 *
 * <p>{@link #fijarActor} deja el usuario, la IP y el request_id en variables de la transacción; el trigger
 * {@code fn_auditoria()} de la BD los lee al registrar cada cambio. {@link #registrar} agrega además una entrada
 * legible ("Creó la cola Caja").
 */
@Service
public class Auditoria {

    private static final Logger log = LoggerFactory.getLogger(Auditoria.class);

    private final JdbcClient jdbc;
    private final ObjectMapper json;

    Auditoria(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** Debe llamarse dentro de la transacción que hace los cambios ({@code @Transactional}). */
    public void fijarActor(Actor actor) {
        jdbc.sql("SELECT set_config('app.usuario_id', :usuario, true), set_config('app.request_id', :request, true), set_config('app.ip', :ip, true)")
                .param("usuario", actor.usuarioId() == null ? "" : String.valueOf(actor.usuarioId()))
                .param("request", actor.requestId() == null ? "" : actor.requestId())
                .param("ip", actor.ip() == null ? "" : actor.ip())
                .query((rs, i) -> 1)
                .list();
    }

    public void registrar(Actor actor, Integer localId, String accion, String entidad, Object entidadId, String humana, Object datos) {
        try {
            jdbc.sql("""
                            INSERT INTO auditoria (local_id, usuario_id, accion, entidad, entidad_id, datos_json, ip, request_id, accion_humana)
                            VALUES (:local, :usuario, :accion, :entidad, :entidadId, CAST(:datos AS jsonb), :ip, :request, :humana)""")
                    .param("local", localId)
                    .param("usuario", actor.usuarioId())
                    .param("accion", accion)
                    .param("entidad", entidad)
                    .param("entidadId", entidadId == null ? null : String.valueOf(entidadId))
                    .param("datos", datos == null ? null : json.writeValueAsString(datos))
                    .param("ip", actor.ip())
                    .param("request", actor.requestId())
                    .param("humana", humana)
                    .update();
        } catch (RuntimeException e) {
            // La auditoría legible nunca bloquea la operación (el trigger ya registró el cambio)
            log.warn("No se pudo registrar la auditoría {} {}: {}", accion, entidad, e.getMessage());
        }
    }

    /** Quién hace el cambio. */
    public record Actor(Integer usuarioId, String requestId, String ip) {
        public static final Actor SISTEMA = new Actor(null, null, null);

        public static Actor de(Sesion sesion, HttpServletRequest peticion) {
            return new Actor(sesion == null ? null : sesion.sub(), FiltroIdPeticion.de(peticion), IpCliente.de(peticion));
        }
    }
}
