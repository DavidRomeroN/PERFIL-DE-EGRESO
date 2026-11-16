package pe.turnoya.plataforma.usuarios;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.RolUsuario;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** Página de usuarios del local: crear, editar (con cambio de contraseña opcional y las ventanillas del operador) y eliminar. */
@Controller
@SoloAdmin
class AdminUsuariosVista {

    private final GestionUsuarios usuarios;
    private final LocalDeTrabajo localDeTrabajo;

    AdminUsuariosVista(GestionUsuarios usuarios, LocalDeTrabajo localDeTrabajo) {
        this.usuarios = usuarios;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/admin/usuarios")
    String pagina(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        cargar(sesion, peticion, modelo);
        return "admin/usuarios";
    }

    @PostMapping("/admin/usuarios")
    String crear(@AuthenticationPrincipal Sesion sesion, @RequestParam String nombre, @RequestParam String email, @RequestParam String password,
                 @RequestParam RolUsuario rol, @RequestParam(name = "ventanilla", required = false) List<Integer> ventanillas,
                 HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        var u = usuarios.crear(localDeTrabajo.resolver(sesion, peticion),
                new GestionUsuarios.DatosUsuario(nombre, email, password, rol, true, ventanillas == null ? List.of() : ventanillas),
                Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Usuario " + u.email() + " creado");
        return lista(sesion, peticion, modelo);
    }

    @PostMapping("/admin/usuarios/{id}")
    String editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam String nombre, @RequestParam String email,
                  @RequestParam(required = false) String password, @RequestParam RolUsuario rol,
                  @RequestParam(defaultValue = "false") boolean activo, @RequestParam(name = "ventanilla", required = false) List<Integer> ventanillas,
                  HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        usuarios.editar(localDeTrabajo.resolver(sesion, peticion), id,
                new GestionUsuarios.DatosUsuario(nombre, email, password, rol, activo, ventanillas == null ? List.of() : ventanillas),
                sesion.sub(), Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Cambios guardados");
        return lista(sesion, peticion, modelo);
    }

    @PostMapping("/admin/usuarios/{id}/eliminar")
    String eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, HttpServletResponse respuesta,
                    Model modelo) {
        usuarios.eliminar(localDeTrabajo.resolver(sesion, peticion), id, sesion.sub(), Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Usuario eliminado");
        return lista(sesion, peticion, modelo);
    }

    private String lista(Sesion sesion, HttpServletRequest peticion, Model modelo) {
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/admin/usuarios";
        }
        cargar(sesion, peticion, modelo);
        return "admin/usuarios :: lista";
    }

    private void cargar(Sesion sesion, HttpServletRequest peticion, Model modelo) {
        modelo.addAttribute("seccion", "usuarios");
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modelo.addAttribute("usuarios", usuarios.listar(localId));
        modelo.addAttribute("ventanillas", usuarios.ventanillas(localId));
        modelo.addAttribute("asignaciones", usuarios.asignaciones(localId));
    }
}
