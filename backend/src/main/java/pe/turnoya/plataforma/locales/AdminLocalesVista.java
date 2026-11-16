package pe.turnoya.plataforma.locales;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloSuperAdmin;
import pe.turnoya.plataforma.planes.GestionPlanes;

/** Página "Locales y planes" del super admin: alta (con admin inicial opcional), edición y baja lógica. */
@Controller
@SoloSuperAdmin
class AdminLocalesVista {

    private final GestionLocales locales;
    private final GestionPlanes planes;

    AdminLocalesVista(GestionLocales locales, GestionPlanes planes) {
        this.locales = locales;
        this.planes = planes;
    }

    @GetMapping("/admin/locales")
    String pagina(Model modelo) {
        cargar(modelo);
        return "admin/locales";
    }

    @PostMapping("/admin/locales")
    String crear(@AuthenticationPrincipal Sesion sesion, @RequestParam String slug, @RequestParam String nombreComercial,
                 @RequestParam String razonSocial, @RequestParam(required = false) String ruc, @RequestParam(required = false) String rubro,
                 @RequestParam(required = false) String direccion, @RequestParam(required = false) String telefono,
                 @RequestParam(required = false) String ciudad, @RequestParam Integer planId, @RequestParam(required = false) String colorPrimario,
                 @RequestParam(required = false) String adminNombre, @RequestParam(required = false) String adminEmail,
                 @RequestParam(required = false) String adminPassword, HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        var l = locales.crear(new GestionLocales.Formulario(slug, nombreComercial, razonSocial, ruc, rubro, direccion, telefono, ciudad, planId,
                colorPrimario, adminNombre, adminEmail, adminPassword), Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Local " + l.nombreComercial() + " creado");
        return lista(peticion, modelo);
    }

    @PostMapping("/admin/locales/{id}")
    String editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam String slug, @RequestParam String nombreComercial,
                  @RequestParam String razonSocial, @RequestParam(required = false) String ruc, @RequestParam(required = false) String rubro,
                  @RequestParam(required = false) String direccion, @RequestParam(required = false) String telefono,
                  @RequestParam(required = false) String ciudad, @RequestParam Integer planId, @RequestParam(required = false) String colorPrimario,
                  @RequestParam(defaultValue = "false") boolean activo, HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        locales.editar(id, new GestionLocales.Formulario(slug, nombreComercial, razonSocial, ruc, rubro, direccion, telefono, ciudad, planId,
                colorPrimario, null, null, null), activo, Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Cambios guardados");
        return lista(peticion, modelo);
    }

    @PostMapping("/admin/locales/{id}/desactivar")
    String desactivar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, HttpServletResponse respuesta,
                      Model modelo) {
        var l = locales.desactivar(id, Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Local " + l.nombreComercial() + " desactivado");
        return lista(peticion, modelo);
    }

    private String lista(HttpServletRequest peticion, Model modelo) {
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/admin/locales";
        }
        cargar(modelo);
        return "admin/locales :: lista";
    }

    private void cargar(Model modelo) {
        modelo.addAttribute("seccion", "locales");
        modelo.addAttribute("locales", locales.listar());
        modelo.addAttribute("planes", planes.listar());
    }
}
