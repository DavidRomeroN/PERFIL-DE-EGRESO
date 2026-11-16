package pe.turnoya.nucleo.reportes;

import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** {@code GET /api/v1/reportes/espera?desde&hasta[&formato=csv]} (RF09), mismo contrato que el sistema anterior. */
@RestController
@SoloAdmin
class ReportesApi {

    private final ReportesTurnos reportes;
    private final LocalDeTrabajo localDeTrabajo;

    ReportesApi(ReportesTurnos reportes, LocalDeTrabajo localDeTrabajo) {
        this.reportes = reportes;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/api/v1/reportes/espera")
    ResponseEntity<?> espera(@AuthenticationPrincipal Sesion sesion,
                             @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate desde,
                             @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate hasta,
                             @RequestParam(required = false) String formato, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        LocalDate fin = hasta != null ? hasta : reportes.haceDias(localId, 0);
        ReporteEspera r = reportes.generar(localId, desde != null ? desde : fin.minusDays(13), fin);
        return "csv".equals(formato) ? ReportesVista.descarga(r) : ResponseEntity.ok(RespuestaApi.ok(r));
    }
}
