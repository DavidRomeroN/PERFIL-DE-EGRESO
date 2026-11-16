package pe.turnoya.plataforma.planes;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.math.BigDecimal;
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
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloSuperAdmin;

/** Página "Planes y módulos" del super admin: límites de cada plan y qué módulos incluye. */
@Controller
@SoloSuperAdmin
class AdminPlanesVista {

    private final GestionPlanes planes;

    AdminPlanesVista(GestionPlanes planes) {
        this.planes = planes;
    }

    @GetMapping("/admin/planes")
    String pagina(Model modelo) {
        cargar(modelo);
        return "admin/planes";
    }

    @PostMapping("/admin/planes")
    String crear(@AuthenticationPrincipal Sesion sesion, @RequestParam String codigo, @RequestParam String nombre,
                 @RequestParam BigDecimal precioMensual, @RequestParam Integer maxTurnosMes, @RequestParam Integer maxColas,
                 @RequestParam Integer maxVentanillas, @RequestParam(defaultValue = "false") boolean whatsappHabilitado,
                 @RequestParam(defaultValue = "0") Integer maxAvisosWhatsapp, @RequestParam(defaultValue = "false") boolean reportes,
                 @RequestParam(required = false) String descripcion, @RequestParam(required = false) List<String> modulos,
                 HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        var p = planes.crear(new GestionPlanes.Formulario(codigo, nombre, precioMensual, maxTurnosMes, maxColas, maxVentanillas, whatsappHabilitado,
                maxAvisosWhatsapp, reportes, descripcion, modulos), Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Plan " + p.nombre() + " creado");
        return lista(peticion, modelo);
    }

    @PostMapping("/admin/planes/{id}")
    String editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam String codigo, @RequestParam String nombre,
                  @RequestParam BigDecimal precioMensual, @RequestParam Integer maxTurnosMes, @RequestParam Integer maxColas,
                  @RequestParam Integer maxVentanillas, @RequestParam(defaultValue = "false") boolean whatsappHabilitado,
                  @RequestParam(defaultValue = "0") Integer maxAvisosWhatsapp, @RequestParam(defaultValue = "false") boolean reportes,
                  @RequestParam(required = false) String descripcion, @RequestParam(required = false) List<String> modulos,
                  HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        var p = planes.editar(id, new GestionPlanes.Formulario(codigo, nombre, precioMensual, maxTurnosMes, maxColas, maxVentanillas,
                whatsappHabilitado, maxAvisosWhatsapp, reportes, descripcion, modulos), Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Plan " + p.nombre() + " guardado");
        return lista(peticion, modelo);
    }

    @PostMapping("/admin/planes/{id}/eliminar")
    String eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, HttpServletResponse respuesta,
                    Model modelo) {
        planes.eliminar(id, Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Plan eliminado");
        return lista(peticion, modelo);
    }

    private String lista(HttpServletRequest peticion, Model modelo) {
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/admin/planes";
        }
        cargar(modelo);
        return "admin/planes :: lista";
    }

    private void cargar(Model modelo) {
        modelo.addAttribute("seccion", "planes");
        modelo.addAttribute("planes", planes.listar());
        modelo.addAttribute("modulos", Modulo.values());
    }
}
