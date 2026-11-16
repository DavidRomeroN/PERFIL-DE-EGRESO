package pe.turnoya.prioridades.verificacion;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloPersonal;

/** {@code PATCH /api/v1/turnos/{id}/prioridad} y {@code GET /api/v1/prioridades/explicacion} (personal del local, M1). */
@RestController
@SoloPersonal
class VerificacionApi {

    private final VerificacionPrioridad verificacion;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;

    VerificacionApi(VerificacionPrioridad verificacion, LocalDeTrabajo localDeTrabajo, ModulosLocal modulos) {
        this.verificacion = verificacion;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
    }

    @PatchMapping("/api/v1/turnos/{id}/prioridad")
    RespuestaApi<Map<String, Object>> cambiar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestBody Cambio b,
                                              HttpServletRequest peticion) {
        VerificacionPrioridad.Accion accion;
        try {
            accion = VerificacionPrioridad.Accion.valueOf(b.accion() == null ? "" : b.accion());
        } catch (IllegalArgumentException e) {
            throw new ErrorNegocio("VALIDACION", "Acción: VERIFICAR, RECHAZAR o CAMBIAR", 422);
        }
        return RespuestaApi.ok(verificacion.cambiar(local(sesion, peticion), id, accion, b.categoriaCodigo(), Auditoria.Actor.de(sesion, peticion)));
    }

    @GetMapping("/api/v1/prioridades/explicacion")
    RespuestaApi<VerificacionPrioridad.Explicacion> explicacion(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) Integer colaId,
                                                               HttpServletRequest peticion) {
        return RespuestaApi.ok(verificacion.explicacionSiguiente(local(sesion, peticion), colaId).orElse(null));
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modulos.exigir(localId, Modulo.M1);
        return localId;
    }

    record Cambio(String accion, String categoriaCodigo) {
    }
}
