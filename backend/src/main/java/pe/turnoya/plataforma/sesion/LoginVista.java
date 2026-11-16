package pe.turnoya.plataforma.sesion;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.plataforma.Sesion;

/** Pantalla de ingreso (formulario HTML clásico, sin JavaScript). */
@Controller
class LoginVista {

    private final InicioSesion inicioSesion;
    private final CookiesSesion cookies;
    /** Las cuentas del seed solo se muestran en desarrollo (application-dev.yml): en producción serían una puerta abierta. */
    private final boolean mostrarCuentasDemo;

    LoginVista(InicioSesion inicioSesion, CookiesSesion cookies, @Value("${turnoya.mostrar-cuentas-demo:false}") boolean mostrarCuentasDemo) {
        this.inicioSesion = inicioSesion;
        this.cookies = cookies;
        this.mostrarCuentasDemo = mostrarCuentasDemo;
    }

    @GetMapping("/login")
    String formulario(@RequestParam(required = false) String next, @RequestParam(required = false) String email, Model modelo) {
        modelo.addAttribute("next", destinoSeguro(next));
        modelo.addAttribute("email", email == null ? "" : email);
        modelo.addAttribute("cuentasDemo", mostrarCuentasDemo);
        return "auth/login";
    }

    @PostMapping("/login")
    String entrar(@RequestParam String email, @RequestParam String password, @RequestParam(required = false) String next,
                  HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        try {
            InicioSesion.Resultado r = inicioSesion.entrar(email, password, IpCliente.de(peticion));
            respuesta.addHeader(HttpHeaders.SET_COOKIE, cookies.crear(r.token()).toString());
            String destino = destinoSeguro(next);
            return "redirect:" + (destino != null ? destino : inicioPorRol(r.sesion()));
        } catch (ErrorNegocio e) {
            respuesta.setStatus(e.status());
            modelo.addAttribute("error", e.getMessage());
            modelo.addAttribute("email", email);
            modelo.addAttribute("next", destinoSeguro(next));
            modelo.addAttribute("cuentasDemo", mostrarCuentasDemo);
            return "auth/login";
        }
    }

    @PostMapping("/salir")
    String salir(HttpServletResponse respuesta) {
        respuesta.addHeader(HttpHeaders.SET_COOKIE, cookies.borrar().toString());
        return "redirect:/login";
    }

    private static String inicioPorRol(Sesion sesion) {
        return sesion.esAdmin() ? "/admin" : "/panel";
    }

    /** Solo rutas internas: evita redirecciones abiertas hacia otros sitios. */
    private static String destinoSeguro(String next) {
        return next != null && next.startsWith("/") && !next.startsWith("//") ? next : null;
    }
}
