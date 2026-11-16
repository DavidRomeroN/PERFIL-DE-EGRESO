package pe.turnoya.plataforma.jobs;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloSuperAdmin;

/** Página "Tareas programadas" del super admin: última corrida, duración, resultado, próxima y "ejecutar ahora". */
@Controller
@SoloSuperAdmin
class AdminJobsVista {

    private final TareasPlataforma tareas;

    AdminJobsVista(TareasPlataforma tareas) {
        this.tareas = tareas;
    }

    @GetMapping("/admin/jobs")
    String pagina(HttpServletRequest peticion, Model modelo) {
        modelo.addAttribute("seccion", "jobs");
        modelo.addAttribute("tareas", tareas.estado());
        return Htmx.esPeticion(peticion) ? "admin/jobs :: lista" : "admin/jobs";
    }

    @PostMapping("/admin/jobs/{nombre}")
    String ejecutar(@AuthenticationPrincipal Sesion sesion, @PathVariable String nombre, HttpServletRequest peticion, HttpServletResponse respuesta,
                    Model modelo) {
        Object resultado = tareas.ejecutar(nombre, Auditoria.Actor.de(sesion, peticion));
        if (resultado instanceof Map<?, ?> m && m.containsKey("error")) {
            Htmx.aviso(respuesta, Htmx.Tipo.ERROR, "El job " + nombre + " falló: " + m.get("error"));
        } else if (resultado instanceof Map<?, ?> m && Boolean.TRUE.equals(m.get("omitida"))) {
            Htmx.aviso(respuesta, Htmx.Tipo.INFO, "El job " + nombre + " ya se está ejecutando");
        } else {
            Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Job " + nombre + " ejecutado");
        }
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/admin/jobs";
        }
        modelo.addAttribute("tareas", tareas.estado());
        return "admin/jobs :: lista";
    }
}
