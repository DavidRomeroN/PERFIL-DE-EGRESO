package pe.turnoya.nucleo.atencion;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.SnapshotLocal;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloPersonal;

/**
 * API de la ventanilla: foto del local con nombres, llamar al siguiente (RF05) y cambiar el estado del turno
 * en atención (RF06). El local sale siempre de la sesión, nunca del cuerpo.
 */
@RestController
@SoloPersonal
class AtencionApi {

    private final ConsultaTurnos consulta;
    private final OperacionVentanilla operacion;
    private final CatalogoLocales locales;
    private final LocalDeTrabajo localDeTrabajo;
    private final AccesoVentanillas acceso;

    AtencionApi(ConsultaTurnos consulta, OperacionVentanilla operacion, CatalogoLocales locales, LocalDeTrabajo localDeTrabajo,
                AccesoVentanillas acceso) {
        this.consulta = consulta;
        this.operacion = operacion;
        this.locales = locales;
        this.localDeTrabajo = localDeTrabajo;
        this.acceso = acceso;
    }

    /** {@code GET /api/v1/panel/estado}: foto del local del operador (super admin: {@code ?slug=}). */
    @GetMapping("/api/v1/panel/estado")
    ResponseEntity<RespuestaApi<SnapshotLocal>> estado(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String slug) {
        SnapshotLocal snap = consulta.snapshot(LocalDelPanel.resolver(sesion, slug, locales), true);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(RespuestaApi.ok(snap));
    }

    @PostMapping("/api/v1/ventanillas/{id}/llamar-siguiente")
    RespuestaApi<Map<String, Object>> llamarSiguiente(@PathVariable int id, @AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        acceso.exigirVentanilla(sesion, id);
        Optional<TurnoPublico> turno = operacion.llamarSiguiente(id, localDeTrabajo.resolver(sesion, peticion), Auditoria.Actor.de(sesion, peticion));
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("turno", turno.orElse(null));
        data.put("vacia", turno.isEmpty());
        return RespuestaApi.ok(data);
    }

    @PatchMapping("/api/v1/turnos/{id}/estado")
    RespuestaApi<Map<String, Object>> cambiarEstado(@PathVariable int id, @Valid @RequestBody CambioEstado cambio,
                                                    @AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        if (cambio.estado() == EstadoTurno.EMITIDO || cambio.estado() == EstadoTurno.AVISADO || cambio.estado() == EstadoTurno.TRANSFERIDO) {
            throw new ErrorNegocio("VALIDACION", "estado: debe ser LLAMADO, ATENDIDO, NO_SE_PRESENTO o CANCELADO", 422);
        }
        int localId = localDeTrabajo.resolver(sesion, peticion);
        acceso.exigirTurno(sesion, localId, id);
        Turno t = operacion.cambiarEstado(id, localId, cambio.estado(), Auditoria.Actor.de(sesion, peticion));
        return RespuestaApi.ok(Map.of("id", t.id(), "estado", t.estado(), "rellamadas", t.rellamadas()));
    }

    record CambioEstado(@NotNull EstadoTurno estado) {
    }
}
