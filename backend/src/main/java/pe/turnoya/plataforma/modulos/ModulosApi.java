package pe.turnoya.plataforma.modulos;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.SoloPersonal;

/** {@code GET /api/v1/modulos} y {@code PUT /api/v1/modulos/{codigo}}, como el sistema anterior. */
@RestController
class ModulosApi {

    private final HubModulos hub;
    private final LocalDeTrabajo localDeTrabajo;

    ModulosApi(HubModulos hub, LocalDeTrabajo localDeTrabajo) {
        this.hub = hub;
        this.localDeTrabajo = localDeTrabajo;
    }

    @SoloPersonal
    @GetMapping("/api/v1/modulos")
    RespuestaApi<List<HubModulos.EstadoModulo>> estado(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(hub.estado(localDeTrabajo.resolver(sesion, peticion)));
    }

    @SoloAdmin
    @PutMapping("/api/v1/modulos/{codigo}")
    RespuestaApi<List<HubModulos.EstadoModulo>> cambiar(@AuthenticationPrincipal Sesion sesion, @PathVariable String codigo,
                                                        @RequestBody Map<String, Boolean> cuerpo, HttpServletRequest peticion) {
        return RespuestaApi.ok(hub.cambiar(localDeTrabajo.resolver(sesion, peticion), codigo, Boolean.TRUE.equals(cuerpo.get("habilitado")),
                Auditoria.Actor.de(sesion, peticion)));
    }
}
