package pe.turnoya.plataforma.auditoria;

import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** {@code GET /api/v1/auditoria?desde&hasta&accion&entidad&texto&requestId&cursor[&formato=csv]} (N01). */
@RestController
@SoloAdmin
class AuditoriaApi {

    private final ConsultaAuditoria consulta;
    private final LocalDeTrabajo localDeTrabajo;

    AuditoriaApi(ConsultaAuditoria consulta, LocalDeTrabajo localDeTrabajo) {
        this.consulta = consulta;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/api/v1/auditoria")
    Object consultar(@AuthenticationPrincipal Sesion sesion,
                     @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate desde,
                     @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate hasta,
                     @RequestParam(required = false) String accion, @RequestParam(required = false) String entidad,
                     @RequestParam(required = false) String texto, @RequestParam(required = false) String requestId,
                     @RequestParam(required = false) Long cursor, @RequestParam(required = false) String formato, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        var filtros = new ConsultaAuditoria.Filtros(desde, hasta, accion, entidad, texto, requestId, cursor);
        return "csv".equals(formato) ? consulta.csv(localId, filtros) : RespuestaApi.ok(consulta.pagina(localId, filtros));
    }
}
