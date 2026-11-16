package pe.turnoya.plataforma.sesion;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.RolUsuario;
import pe.turnoya.plataforma.Sesion;

/** {@code /api/v1/auth/*}: mismo contrato que el sistema anterior (login devuelve la sesión y deja la cookie). */
@RestController
@RequestMapping("/api/v1/auth")
class AuthApi {

    private final InicioSesion inicioSesion;
    private final CookiesSesion cookies;

    AuthApi(InicioSesion inicioSesion, CookiesSesion cookies) {
        this.inicioSesion = inicioSesion;
        this.cookies = cookies;
    }

    @PostMapping("/login")
    ResponseEntity<RespuestaApi<Sesion>> login(@Valid @RequestBody Credenciales credenciales, HttpServletRequest peticion) {
        InicioSesion.Resultado r = inicioSesion.entrar(credenciales.email(), credenciales.password(), IpCliente.de(peticion));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookies.crear(r.token()).toString())
                .body(RespuestaApi.ok(r.sesion()));
    }

    /**
     * Ingreso desde la app móvil del personal: devuelve el token para {@code Authorization: Bearer} (sin cookie). Solo
     * el admin del local, los operadores y la recepción (kiosco); la app no tiene la vista de plataforma.
     */
    @PostMapping("/movil")
    RespuestaApi<SesionMovil> movil(@Valid @RequestBody Credenciales credenciales, HttpServletRequest peticion) {
        InicioSesion.Resultado r = inicioSesion.entrar(credenciales.email(), credenciales.password(), IpCliente.de(peticion));
        RolUsuario rol = r.sesion().rol();
        boolean delNegocio = rol == RolUsuario.ADMIN_LOCAL || rol == RolUsuario.OPERADOR || rol == RolUsuario.KIOSCO;
        if (!delNegocio || r.sesion().localId() == null) {
            throw ErrorNegocio.prohibido("ROL_NO_DISPONIBLE_EN_APP", "La app es para el personal del negocio. Usa la web.");
        }
        return RespuestaApi.ok(new SesionMovil(r.token(), r.sesion()));
    }

    record SesionMovil(String token, Sesion sesion) {
    }

    @PostMapping("/logout")
    ResponseEntity<RespuestaApi<Void>> logout() {
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookies.borrar().toString())
                .body(RespuestaApi.ok(null));
    }

    @GetMapping("/me")
    RespuestaApi<Sesion> yo(@AuthenticationPrincipal Sesion sesion) {
        if (sesion == null) {
            throw new ErrorNegocio("NO_AUTENTICADO", "Sin sesión", 401);
        }
        return RespuestaApi.ok(sesion);
    }

    record Credenciales(
            @NotBlank @Email(message = "Correo inválido") String email,
            @NotBlank @Size(min = 4, message = "Contraseña muy corta") String password) {
    }
}
