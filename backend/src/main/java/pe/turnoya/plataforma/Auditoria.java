package pe.turnoya.plataforma;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.web.FiltroIdPeticion;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.plataforma.dominio.RepositorioAuditoria;
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

    private final RepositorioAuditoria repositorio;
    private final ObjectMapper json;

    Auditoria(RepositorioAuditoria repositorio, ObjectMapper json) {
        this.repositorio = repositorio;
        this.json = json;
    }

    /** Debe llamarse dentro de la transacción que hace los cambios ({@code @Transactional}). */
    public void fijarActor(Actor actor) {
        repositorio.fijarActor(actor);
    }

    public void registrar(Actor actor, Integer localId, String accion, String entidad, Object entidadId, String humana, Object datos) {
        try {
            repositorio.registrar(actor, localId, accion, entidad, entidadId == null ? null : String.valueOf(entidadId),
                    datos == null ? null : json.writeValueAsString(datos), humana);
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
