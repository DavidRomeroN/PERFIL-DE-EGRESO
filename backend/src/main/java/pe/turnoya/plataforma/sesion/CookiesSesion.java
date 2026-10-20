package pe.turnoya.plataforma.sesion;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Arrays;
import java.util.Optional;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;

/** Cookie {@code turnoya_session}: httpOnly, SameSite=Lax, 12 horas (igual que legacy/). */
@Component
public class CookiesSesion {

    public static final String NOMBRE = "turnoya_session";

    private final boolean segura;

    CookiesSesion(PropiedadesTurnoYa propiedades) {
        this.segura = propiedades.seguridad().cookieSegura() || propiedades.appUrl().startsWith("https");
    }

    public ResponseCookie crear(String token) {
        return ResponseCookie.from(NOMBRE, token)
                .httpOnly(true)
                .sameSite("Lax")
                .secure(segura)
                .path("/")
                .maxAge(FirmaSesion.DURACION)
                .build();
    }

    public ResponseCookie borrar() {
        return ResponseCookie.from(NOMBRE, "").httpOnly(true).sameSite("Lax").secure(segura).path("/").maxAge(0).build();
    }

    static Optional<String> leer(HttpServletRequest peticion) {
        if (peticion.getCookies() == null) {
            return Optional.empty();
        }
        return Arrays.stream(peticion.getCookies())
                .filter(c -> NOMBRE.equals(c.getName()))
                .map(Cookie::getValue)
                .filter(v -> !v.isBlank())
                .findFirst();
    }
}
