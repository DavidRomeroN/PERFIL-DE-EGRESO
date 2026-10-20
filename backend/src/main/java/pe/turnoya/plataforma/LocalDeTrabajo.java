package pe.turnoya.plataforma;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Arrays;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.ErrorNegocio;

/**
 * Aislamiento multi-tenant (§9.2): el local sobre el que actúa el personal sale SIEMPRE de la sesión, nunca del
 * cuerpo de la petición. Solo el super administrador elige el local ({@code ?localId=}, luego la cookie
 * {@code turnoya_local}, luego el primer local activo). Equivale a {@code localDeSesion} de legacy/.
 */
@Service
public class LocalDeTrabajo {

    public static final String COOKIE = "turnoya_local";

    private final CatalogoLocales locales;

    LocalDeTrabajo(CatalogoLocales locales) {
        this.locales = locales;
    }

    public int resolver(Sesion sesion, HttpServletRequest peticion) {
        if (!sesion.esSuperAdmin()) {
            if (sesion.localId() == null) {
                throw new ErrorNegocio("SIN_LOCAL", "El usuario no tiene local asignado", 400);
            }
            return sesion.localId();
        }
        Integer pedido = entero(peticion.getParameter("localId"));
        if (pedido != null) {
            return pedido;
        }
        Integer cookie = peticion.getCookies() == null ? null : Arrays.stream(peticion.getCookies())
                .filter(c -> COOKIE.equals(c.getName())).map(Cookie::getValue).map(LocalDeTrabajo::entero)
                .filter(v -> v != null && v > 0).findFirst().orElse(null);
        if (cookie != null) {
            return cookie;
        }
        if (sesion.localId() != null) {
            return sesion.localId();
        }
        return locales.activos().stream().findFirst()
                .orElseThrow(() -> ErrorNegocio.noEncontrado("SIN_LOCAL", "No hay locales registrados"))
                .id();
    }

    public Local local(Sesion sesion, HttpServletRequest peticion) {
        return locales.exigir(resolver(sesion, peticion));
    }

    private static Integer entero(String valor) {
        return valor != null && valor.matches("\\d{1,9}") ? Integer.valueOf(valor) : null;
    }
}
