package pe.turnoya.plataforma.dominio;

import java.time.Instant;
import java.util.List;
import pe.turnoya.plataforma.Auditoria.Actor;

/** Puerto de salida: registro de auditoría. Lo implementa {@code infraestructura.AuditoriaJdbc}. */
public interface RepositorioAuditoria {

    /** Deja el actor en variables de la transacción actual para el trigger {@code fn_auditoria()}. */
    void fijarActor(Actor actor);

    void registrar(Actor actor, Integer localId, String accion, String entidad, String entidadId, String datosJson, String humana);

    /** Eventos del local, del más reciente al más antiguo; {@code cursor} pagina por id ("más antiguos que"). */
    List<FilaAuditoria> consultar(int localId, FiltroAuditoria filtro, int limite);

    record FiltroAuditoria(Instant desde, Instant hasta, String accion, String entidad, String texto, String requestId, Long cursor) {
    }

    record FilaAuditoria(long id, Instant createdAt, String accion, String entidad, String entidadId, String accionHumana, String ip,
                         String requestId, String datosJson, String usuarioNombre, String usuarioEmail) {
    }
}
