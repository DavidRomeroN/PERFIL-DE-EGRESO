package pe.turnoya.plataforma.sesion;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Set;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Plan;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/**
 * Datos del marco de la administración (menú lateral): el local sobre el que se trabaja, su plan, los módulos
 * encendidos (cada entrada de módulo solo aparece si está activo) y, para el super administrador, la lista de locales
 * para cambiar de local.
 */
@ControllerAdvice(annotations = Controller.class)
class MarcoAdminVista {

    private final LocalDeTrabajo localDeTrabajo;
    private final CatalogoLocales locales;
    private final ModulosLocal modulos;

    MarcoAdminVista(LocalDeTrabajo localDeTrabajo, CatalogoLocales locales, ModulosLocal modulos) {
        this.localDeTrabajo = localDeTrabajo;
        this.locales = locales;
        this.modulos = modulos;
    }

    @ModelAttribute("marco")
    MarcoAdmin marco(HttpServletRequest peticion) {
        if (!peticion.getRequestURI().startsWith("/admin") || "true".equals(peticion.getHeader("HX-Request"))) {
            return null;
        }
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        if (a == null || !(a.getPrincipal() instanceof Sesion sesion) || !sesion.esAdmin()) {
            return null;
        }
        try {
            Local local = localDeTrabajo.local(sesion, peticion);
            return new MarcoAdmin(local, locales.planDe(local), modulos.activos(local.id()),
                    sesion.esSuperAdmin() ? locales.activos() : List.of());
        } catch (ErrorNegocio e) {
            return new MarcoAdmin(null, null, Set.of(), List.of());
        }
    }

    public record MarcoAdmin(Local local, Plan plan, Set<Modulo> modulos, List<Local> locales) {

        public boolean modulo(String codigo) {
            return modulos.stream().anyMatch(m -> m.name().equals(codigo));
        }
    }

    /** Selector de local del super administrador: guarda la elección en la cookie {@code turnoya_local}. */
    @Controller
    @SoloAdmin
    static class CambioDeLocal {

        @PostMapping("/admin/local-activo")
        String cambiar(@AuthenticationPrincipal Sesion sesion, @RequestParam int localId, HttpServletRequest peticion,
                       HttpServletResponse respuesta) {
            if (!sesion.esSuperAdmin()) {
                throw ErrorNegocio.prohibido("PROHIBIDO", "Solo el super administrador cambia de local");
            }
            Cookie cookie = new Cookie(LocalDeTrabajo.COOKIE, String.valueOf(localId));
            cookie.setPath("/");
            cookie.setHttpOnly(true);
            cookie.setMaxAge(60 * 60 * 24 * 30);
            cookie.setAttribute("SameSite", "Lax");
            respuesta.addCookie(cookie);
            String origen = peticion.getHeader("Referer");
            return "redirect:" + (origen != null && origen.contains("/admin") ? origen.substring(origen.indexOf("/admin")) : "/admin");
        }
    }
}
