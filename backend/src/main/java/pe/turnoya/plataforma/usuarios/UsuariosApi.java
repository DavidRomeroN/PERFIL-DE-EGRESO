package pe.turnoya.plataforma.usuarios;

import jakarta.servlet.http.HttpServletRequest;
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
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.dominio.RepositorioUsuarios.UsuarioFila;

/** {@code /api/v1/usuarios} (RF10), mismo contrato que el sistema anterior. */
@RestController
@SoloAdmin
@RequestMapping("/api/v1/usuarios")
class UsuariosApi {

    private final GestionUsuarios usuarios;
    private final LocalDeTrabajo localDeTrabajo;

    UsuariosApi(GestionUsuarios usuarios, LocalDeTrabajo localDeTrabajo) {
        this.usuarios = usuarios;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping
    RespuestaApi<List<UsuarioFila>> listar(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(usuarios.listar(localDeTrabajo.resolver(sesion, peticion)));
    }

    @PostMapping
    ResponseEntity<RespuestaApi<UsuarioFila>> crear(@AuthenticationPrincipal Sesion sesion, @RequestBody GestionUsuarios.DatosUsuario datos,
                                                    HttpServletRequest peticion) {
        return RespuestaApi.creado(usuarios.crear(localDeTrabajo.resolver(sesion, peticion), datos, Auditoria.Actor.de(sesion, peticion)));
    }

    @PatchMapping("/{id}")
    RespuestaApi<UsuarioFila> editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestBody GestionUsuarios.DatosUsuario datos,
                                     HttpServletRequest peticion) {
        return RespuestaApi.ok(usuarios.editar(localDeTrabajo.resolver(sesion, peticion), id, datos, sesion.sub(), Auditoria.Actor.de(sesion, peticion)));
    }

    @DeleteMapping("/{id}")
    RespuestaApi<Map<String, Boolean>> eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion) {
        usuarios.eliminar(localDeTrabajo.resolver(sesion, peticion), id, sesion.sub(), Auditoria.Actor.de(sesion, peticion));
        return RespuestaApi.ok(Map.of("eliminado", true));
    }
}
