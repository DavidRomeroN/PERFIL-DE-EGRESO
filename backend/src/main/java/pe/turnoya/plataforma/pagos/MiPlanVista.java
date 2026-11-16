package pe.turnoya.plataforma.pagos;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** Página {@code /admin/plan}: plan actual, cambio o renovación con tarjeta (js/pago-plan.js) e historial de pagos. */
@Controller
@SoloAdmin
class MiPlanVista {

    private final SuscripcionPlanes suscripcion;
    private final LocalDeTrabajo localDeTrabajo;

    MiPlanVista(SuscripcionPlanes suscripcion, LocalDeTrabajo localDeTrabajo) {
        this.suscripcion = suscripcion;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/admin/plan")
    String pagina(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        modelo.addAttribute("seccion", "plan");
        modelo.addAttribute("mp", suscripcion.miPlan(localDeTrabajo.resolver(sesion, peticion)));
        return "admin/plan";
    }
}
