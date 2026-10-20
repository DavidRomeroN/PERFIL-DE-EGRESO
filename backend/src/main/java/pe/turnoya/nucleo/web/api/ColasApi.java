package pe.turnoya.nucleo.web.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.aplicacion.GestionColas;
import pe.turnoya.nucleo.dominio.Cola;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.SoloPersonal;

/** {@code /api/v1/colas} (RF08). El local sale siempre de la sesión, nunca del cuerpo. */
@RestController
@RequestMapping("/api/v1/colas")
class ColasApi {

    private final GestionColas colas;
    private final LocalDeTrabajo localDeTrabajo;

    ColasApi(GestionColas colas, LocalDeTrabajo localDeTrabajo) {
        this.colas = colas;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping
    @SoloPersonal
    RespuestaApi<List<GestionColas.ColaAdmin>> listar(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(colas.listar(localDeTrabajo.resolver(sesion, peticion)));
    }

    @PostMapping
    @SoloAdmin
    ResponseEntity<RespuestaApi<Cola>> crear(@Valid @RequestBody GestionColas.DatosCola datos, @AuthenticationPrincipal Sesion sesion,
                                             HttpServletRequest peticion) {
        return RespuestaApi.creado(colas.crear(localDeTrabajo.resolver(sesion, peticion), datos, Auditoria.Actor.de(sesion, peticion)));
    }

    @PatchMapping("/{id}")
    @SoloAdmin
    RespuestaApi<Cola> editar(@PathVariable int id, @Valid @RequestBody GestionColas.CambiosCola cambios, @AuthenticationPrincipal Sesion sesion,
                              HttpServletRequest peticion) {
        return RespuestaApi.ok(colas.editar(localDeTrabajo.resolver(sesion, peticion), id, cambios, Auditoria.Actor.de(sesion, peticion)));
    }

    @DeleteMapping("/{id}")
    @SoloAdmin
    RespuestaApi<Map<String, Object>> eliminar(@PathVariable int id, @AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(colas.eliminar(localDeTrabajo.resolver(sesion, peticion), id, Auditoria.Actor.de(sesion, peticion)));
    }
}
