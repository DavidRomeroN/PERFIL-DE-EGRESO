package pe.turnoya.nucleo.web.vistas;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.util.Optional;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.nucleo.aplicacion.GestionColas;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/**
 * Administración de colas (RF08). Los formularios se envían con htmx y la respuesta es la lista actualizada; los
 * errores de negocio se muestran como aviso sin perder lo escrito.
 */
@Controller
@SoloAdmin
class AdminColasVista {

    private final GestionColas colas;
    private final LocalDeTrabajo localDeTrabajo;

    AdminColasVista(GestionColas colas, LocalDeTrabajo localDeTrabajo) {
        this.colas = colas;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/admin/colas")
    String pagina(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        cargar(sesion, peticion, modelo);
        return "admin/colas";
    }

    @PostMapping("/admin/colas")
    String crear(@AuthenticationPrincipal Sesion sesion, @RequestParam String prefijo, @RequestParam String nombre,
                 @RequestParam(required = false) String descripcion, @RequestParam(defaultValue = "300") int tiempoAtencionBase,
                 HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        validar(prefijo, nombre, tiempoAtencionBase);
        var datos = new GestionColas.DatosCola(prefijo.trim(), nombre, descripcion, tiempoAtencionBase, true, 0);
        var cola = colas.crear(localDeTrabajo.resolver(sesion, peticion), datos, Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Cola " + cola.nombre() + " creada");
        return listaOPagina(sesion, peticion, modelo);
    }

    @PostMapping("/admin/colas/{id}")
    String editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam String prefijo, @RequestParam String nombre,
                  @RequestParam(required = false) String descripcion, @RequestParam int tiempoAtencionBase,
                  @RequestParam(defaultValue = "false") boolean activa, @RequestParam(defaultValue = "0") int orden,
                  HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        validar(prefijo, nombre, tiempoAtencionBase);
        var cambios = new GestionColas.CambiosCola(prefijo.trim(), nombre, Optional.ofNullable(descripcion).or(() -> Optional.of("")),
                tiempoAtencionBase, activa, Math.max(0, orden));
        colas.editar(localDeTrabajo.resolver(sesion, peticion), id, cambios, Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Cambios guardados");
        return listaOPagina(sesion, peticion, modelo);
    }

    @PostMapping("/admin/colas/{id}/eliminar")
    String eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion,
                    HttpServletResponse respuesta, Model modelo) {
        Map<String, Object> r = colas.eliminar(localDeTrabajo.resolver(sesion, peticion), id, Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, r.containsKey("desactivada")
                ? "La cola tiene historial: se desactivó en lugar de eliminarse" : "Cola eliminada");
        return listaOPagina(sesion, peticion, modelo);
    }

    /** Con htmx se devuelve la lista actualizada; con un formulario normal se vuelve a la página. */
    private String listaOPagina(Sesion sesion, HttpServletRequest peticion, Model modelo) {
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/admin/colas";
        }
        cargar(sesion, peticion, modelo);
        return "admin/colas :: lista";
    }

    private void cargar(Sesion sesion, HttpServletRequest peticion, Model modelo) {
        modelo.addAttribute("colas", colas.listar(localDeTrabajo.resolver(sesion, peticion)));
        modelo.addAttribute("seccion", "colas");
    }

    /** Las mismas reglas que DatosCola, con mensajes para el formulario. */
    private static void validar(String prefijo, String nombre, int tiempo) {
        if (prefijo == null || !prefijo.trim().matches("^[A-Za-z0-9]{1,3}$")) {
            throw new ErrorNegocio("VALIDACION", "Prefijo: usa 1 a 3 letras o números (A, B, LAB)", 422);
        }
        if (nombre == null || nombre.trim().length() < 2 || nombre.trim().length() > 60) {
            throw new ErrorNegocio("VALIDACION", "Nombre: entre 2 y 60 caracteres", 422);
        }
        if (tiempo < 30 || tiempo > 3600) {
            throw new ErrorNegocio("VALIDACION", "Tiempo de atención: entre 30 y 3600 segundos", 422);
        }
    }
}
