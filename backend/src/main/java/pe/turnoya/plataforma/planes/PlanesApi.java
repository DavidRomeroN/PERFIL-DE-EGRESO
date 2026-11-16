package pe.turnoya.plataforma.planes;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
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
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.SoloSuperAdmin;
import pe.turnoya.plataforma.dominio.RepositorioPlanes.PlanFila;

/** {@code /api/v1/planes} (N08): el catálogo lo leen los administradores; solo el super admin lo cambia. */
@RestController
@RequestMapping("/api/v1/planes")
class PlanesApi {

    private final GestionPlanes planes;

    PlanesApi(GestionPlanes planes) {
        this.planes = planes;
    }

    @GetMapping
    @SoloAdmin
    RespuestaApi<List<PlanFila>> listar() {
        return RespuestaApi.ok(planes.listar());
    }

    @PostMapping
    @SoloSuperAdmin
    ResponseEntity<RespuestaApi<PlanFila>> crear(@AuthenticationPrincipal Sesion sesion, @RequestBody GestionPlanes.Formulario datos,
                                                 HttpServletRequest peticion) {
        return RespuestaApi.creado(planes.crear(datos, Auditoria.Actor.de(sesion, peticion)));
    }

    @PatchMapping("/{id}")
    @SoloSuperAdmin
    RespuestaApi<PlanFila> editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestBody GestionPlanes.Formulario datos,
                                  HttpServletRequest peticion) {
        return RespuestaApi.ok(planes.editar(id, datos, Auditoria.Actor.de(sesion, peticion)));
    }

    @DeleteMapping("/{id}")
    @SoloSuperAdmin
    RespuestaApi<Map<String, Boolean>> eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion) {
        planes.eliminar(id, Auditoria.Actor.de(sesion, peticion));
        return RespuestaApi.ok(Map.of("eliminado", true));
    }
}
