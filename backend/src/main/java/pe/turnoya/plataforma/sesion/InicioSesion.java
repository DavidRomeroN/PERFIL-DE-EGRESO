package pe.turnoya.plataforma.sesion;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.infraestructura.UsuariosJdbc;

/**
 * Caso de uso "iniciar sesión" (lo usan el formulario y la API).
 * F7: 10 intentos por minuto e IP; 5 fallos seguidos por correo+IP bloquean el acceso 15 minutos.
 */
@Service
public class InicioSesion {

    private static final Duration VENTANA_BLOQUEO = Duration.ofMinutes(15);
    private static final int MAX_FALLOS = 5;

    private final UsuariosJdbc usuarios;
    private final PasswordEncoder claves;
    private final LimitadorPeticiones limitador;
    private final FirmaSesion firma;
    private final Clock reloj;

    InicioSesion(UsuariosJdbc usuarios, PasswordEncoder claves, LimitadorPeticiones limitador, FirmaSesion firma, Clock reloj) {
        this.usuarios = usuarios;
        this.claves = claves;
        this.limitador = limitador;
        this.firma = firma;
        this.reloj = reloj;
    }

    public Resultado entrar(String email, String clave, String ip) {
        if (!limitador.permitir("login", ip, 10)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiados intentos. Espera un minuto.", 429);
        }
        String correo = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        String claveFallos = "login-fallo:" + correo + ":" + ip;
        if (limitador.contador(claveFallos, VENTANA_BLOQUEO) >= MAX_FALLOS) {
            throw new ErrorNegocio("CUENTA_BLOQUEADA", "Demasiados intentos fallidos. Vuelve a intentarlo en 15 minutos.", 429);
        }
        var usuario = usuarios.porEmail(correo)
                .filter(UsuariosJdbc.UsuarioConLocal::activo)
                .filter(u -> u.localId() == null || Boolean.TRUE.equals(u.localActivo()))
                .filter(u -> clave != null && claves.matches(clave, u.hashPassword()));
        if (usuario.isEmpty()) {
            limitador.incrementar(claveFallos, VENTANA_BLOQUEO);
            throw new ErrorNegocio("CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos", 401);
        }
        limitador.borrar(claveFallos);
        var u = usuario.get();
        Instant ahora = reloj.instant();
        usuarios.registrarAcceso(u.id(), ahora);
        Sesion sesion = new Sesion(u.id(), u.email(), u.nombre(), u.rol(), u.localId(), u.localSlug(), u.localNombre());
        return new Resultado(sesion, firma.firmar(sesion, ahora));
    }

    public record Resultado(Sesion sesion, String token) {
    }
}
