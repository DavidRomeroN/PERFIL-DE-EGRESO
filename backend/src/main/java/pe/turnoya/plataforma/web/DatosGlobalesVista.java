package pe.turnoya.plataforma.web;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ModelAttribute;
import pe.turnoya.plataforma.Sesion;

/** Deja {@code sesion} disponible en todas las plantillas (menú de usuario, enlaces según el rol). */
@ControllerAdvice(annotations = Controller.class)
class DatosGlobalesVista {

    @ModelAttribute("sesion")
    Sesion sesion() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        return a != null && a.getPrincipal() instanceof Sesion s ? s : null;
    }
}
