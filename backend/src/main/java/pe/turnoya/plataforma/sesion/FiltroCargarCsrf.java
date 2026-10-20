package pe.turnoya.plataforma.sesion;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Carga el token CSRF antes de generar la página. Spring Security lo crea de forma diferida y, si se pide recién
 * cuando Thymeleaf ya está escribiendo la respuesta, la cookie {@code XSRF-TOKEN} no alcanza a enviarse y las acciones
 * con htmx responden 403. Solo aplica a páginas (no a la API ni al canal SSE).
 */
class FiltroCargarCsrf extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest peticion, HttpServletResponse respuesta, FilterChain cadena)
            throws ServletException, IOException {
        if (peticion.getAttribute(CsrfToken.class.getName()) instanceof CsrfToken token) {
            token.getToken();
        }
        cadena.doFilter(peticion, respuesta);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest peticion) {
        String ruta = peticion.getRequestURI();
        return ruta.startsWith("/api/") || ruta.startsWith("/css/") || ruta.startsWith("/js/") || ruta.startsWith("/webjars/")
                || ruta.startsWith("/img/");
    }
}
