package pe.turnoya.plataforma.sesion;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import java.util.List;
import org.slf4j.MDC;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.RequestAttributeSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.filter.OncePerRequestFilter;
import pe.turnoya.plataforma.Sesion;

/**
 * Lee la cookie de sesión en cada petición y, si el JWT es válido, autentica al usuario con su rol
 * ({@code ROLE_OPERADOR}, {@code ROLE_ADMIN_LOCAL}, {@code ROLE_SUPER_ADMIN}). El principal es {@link Sesion}:
 * los controladores lo reciben con {@code @AuthenticationPrincipal Sesion sesion}.
 *
 * <p>No es un bean: lo crea {@link SeguridadConfig} para que no se registre dos veces como filtro del servlet.
 */
class FiltroSesion extends OncePerRequestFilter {

    private final FirmaSesion firma;
    private final Clock reloj;
    private final SecurityContextRepository contextos = new RequestAttributeSecurityContextRepository();

    FiltroSesion(FirmaSesion firma, Clock reloj) {
        this.firma = firma;
        this.reloj = reloj;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest peticion, HttpServletResponse respuesta, FilterChain cadena)
            throws ServletException, IOException {
        CookiesSesion.leer(peticion)
                .flatMap(token -> firma.verificar(token, reloj.instant()))
                .ifPresent(sesion -> autenticar(sesion, peticion, respuesta));
        try {
            cadena.doFilter(peticion, respuesta);
        } finally {
            MDC.remove("usuario_id");
            MDC.remove("local_id");
        }
    }

    private void autenticar(Sesion sesion, HttpServletRequest peticion, HttpServletResponse respuesta) {
        var autenticacion = new UsernamePasswordAuthenticationToken(sesion, null,
                List.of(new SimpleGrantedAuthority("ROLE_" + sesion.rol().name())));
        SecurityContext contexto = SecurityContextHolder.createEmptyContext();
        contexto.setAuthentication(autenticacion);
        SecurityContextHolder.setContext(contexto);
        // Se registra en la petición (sin sesión de servidor): así Spring Security sabe que ya está autenticado
        contextos.saveContext(contexto, peticion, respuesta);
        MDC.put("usuario_id", String.valueOf(sesion.sub()));
        if (sesion.localId() != null) {
            MDC.put("local_id", String.valueOf(sesion.localId()));
        }
    }
}
