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
import pe.turnoya.nucleo.aplicacion.GestionVentanillas;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** Administración de ventanillas y la cola que atiende cada una (vacía = todas las colas). */
@Controller
@SoloAdmin
class AdminVentanillasVista {

    private final GestionVentanillas ventanillas;
    private final GestionColas colas;
    private final LocalDeTrabajo localDeTrabajo;

    AdminVentanillasVista(GestionVentanillas ventanillas, GestionColas colas, LocalDeTrabajo localDeTrabajo) {
        this.ventanillas = ventanillas;
        this.colas = colas;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/admin/ventanillas")
    String pagina(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        cargar(sesion, peticion, modelo);
        return "admin/ventanillas";
    }

    @PostMapping("/admin/ventanillas")
    String crear(@AuthenticationPrincipal Sesion sesion, @RequestParam String nombre, @RequestParam(required = false) Integer colaId,
                 HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        validar(nombre);
        var v = ventanillas.crear(localDeTrabajo.resolver(sesion, peticion), new GestionVentanillas.DatosVentanilla(nombre, colaId, true),
                Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Ventanilla " + v.nombre() + " creada");
        return listaOPagina(sesion, peticion, modelo);
    }

    @PostMapping("/admin/ventanillas/{id}")
    String editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam String nombre,
                  @RequestParam(required = false) Integer colaId, @RequestParam(defaultValue = "false") boolean activa,
                  HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        validar(nombre);
        ventanillas.editar(localDeTrabajo.resolver(sesion, peticion), id,
                new GestionVentanillas.CambiosVentanilla(nombre, Optional.ofNullable(colaId), activa), Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Cambios guardados");
        return listaOPagina(sesion, peticion, modelo);
    }

    @PostMapping("/admin/ventanillas/{id}/eliminar")
    String eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion,
                    HttpServletResponse respuesta, Model modelo) {
        Map<String, Object> r = ventanillas.eliminar(localDeTrabajo.resolver(sesion, peticion), id, Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, r.containsKey("desactivada")
                ? "La ventanilla tiene historial: se desactivó en lugar de eliminarse" : "Ventanilla eliminada");
        return listaOPagina(sesion, peticion, modelo);
    }

    /** Con htmx se devuelve la lista actualizada; con un formulario normal se vuelve a la página. */
    private String listaOPagina(Sesion sesion, HttpServletRequest peticion, Model modelo) {
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/admin/ventanillas";
        }
        cargar(sesion, peticion, modelo);
        return "admin/ventanillas :: lista";
    }

    private void cargar(Sesion sesion, HttpServletRequest peticion, Model modelo) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modelo.addAttribute("ventanillas", ventanillas.listar(localId));
        modelo.addAttribute("colas", colas.listar(localId));
        modelo.addAttribute("seccion", "ventanillas");
    }

    private static void validar(String nombre) {
        if (nombre == null || nombre.trim().length() < 2 || nombre.trim().length() > 40) {
            throw new ErrorNegocio("VALIDACION", "Nombre: entre 2 y 40 caracteres", 422);
        }
    }
}
