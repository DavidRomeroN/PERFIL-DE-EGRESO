package pe.turnoya.nucleo.historial;

import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloPersonal;

/** {@code GET /api/v1/turnos}: historial del día para la ventanilla (N02), paginado y con indicadores. */
@RestController
@SoloPersonal
class HistorialApi {

    private final HistorialTurnos historial;
    private final LocalDeTrabajo localDeTrabajo;

    HistorialApi(HistorialTurnos historial, LocalDeTrabajo localDeTrabajo) {
        this.historial = historial;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/api/v1/turnos")
    RespuestaApi<HistorialTurnos.Pagina> historial(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion,
                                                   @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fecha,
                                                   @RequestParam(required = false) Integer ventanillaId,
                                                   @RequestParam(required = false) EstadoTurno estado,
                                                   @RequestParam(required = false) Integer cursor) {
        return RespuestaApi.ok(historial.consultar(localDeTrabajo.resolver(sesion, peticion), fecha, ventanillaId, estado, cursor));
    }
}
