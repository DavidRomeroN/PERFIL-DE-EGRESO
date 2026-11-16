package pe.turnoya.plataforma.operacion;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.dominio.RepositorioHorarios.HorarioDia;

/** Página {@code /admin/operacion}: horario semanal y expiración automática de llamados. */
@Controller
@SoloAdmin
class AdminOperacionVista {

    private final GestionOperacion operacion;
    private final LocalDeTrabajo localDeTrabajo;

    AdminOperacionVista(GestionOperacion operacion, LocalDeTrabajo localDeTrabajo) {
        this.operacion = operacion;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/admin/operacion")
    String pagina(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        cargar(sesion, peticion, modelo);
        return "admin/operacion";
    }

    /** El formulario manda {@code activo_N}, {@code apertura_N} y {@code cierre_N} por cada día N (0 = domingo). */
    @PostMapping("/admin/operacion/horario")
    String horario(@AuthenticationPrincipal Sesion sesion, @RequestParam Map<String, String> campos, HttpServletRequest peticion,
                   HttpServletResponse respuesta, Model modelo) {
        List<HorarioDia> dias = new ArrayList<>();
        for (int d = 0; d < 7; d++) {
            dias.add(new HorarioDia(d, campos.get("apertura_" + d), campos.get("cierre_" + d), "true".equals(campos.get("activo_" + d))));
        }
        operacion.guardarHorario(localDeTrabajo.resolver(sesion, peticion), dias, Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Horario guardado");
        return contenido(sesion, peticion, modelo);
    }

    @PostMapping("/admin/operacion/ausencia")
    String ausencia(@AuthenticationPrincipal Sesion sesion, @RequestParam(defaultValue = "false") boolean activada,
                    @RequestParam(required = false) Integer segundos, HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        operacion.guardarAusencia(localDeTrabajo.resolver(sesion, peticion), activada ? (segundos == null ? 180 : segundos) : null,
                Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Guardado");
        return contenido(sesion, peticion, modelo);
    }

    private String contenido(Sesion sesion, HttpServletRequest peticion, Model modelo) {
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/admin/operacion";
        }
        cargar(sesion, peticion, modelo);
        return "admin/operacion :: contenido";
    }

    private void cargar(Sesion sesion, HttpServletRequest peticion, Model modelo) {
        modelo.addAttribute("seccion", "operacion");
        modelo.addAttribute("op", operacion.consultar(localDeTrabajo.resolver(sesion, peticion)));
    }
}
