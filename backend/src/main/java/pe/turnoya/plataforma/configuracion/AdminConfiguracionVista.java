package pe.turnoya.plataforma.configuracion;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.web.GeneradorQr;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.dominio.RepositorioLocales.DatosNegocio;
import pe.turnoya.plataforma.dominio.RepositorioLocales.DatosPantalla;

/** Páginas {@code /admin/configuracion} (datos del negocio y uso del plan) y {@code /admin/pantalla} (TV y QR). */
@Controller
@SoloAdmin
class AdminConfiguracionVista {

    private final ConfiguracionLocal configuracion;
    private final LocalDeTrabajo localDeTrabajo;
    private final PropiedadesTurnoYa propiedades;
    private final GeneradorQr qr;
    private final pe.turnoya.plataforma.ClavePantalla clavePantalla;

    AdminConfiguracionVista(ConfiguracionLocal configuracion, LocalDeTrabajo localDeTrabajo, PropiedadesTurnoYa propiedades, GeneradorQr qr,
                            pe.turnoya.plataforma.ClavePantalla clavePantalla) {
        this.clavePantalla = clavePantalla;
        this.configuracion = configuracion;
        this.localDeTrabajo = localDeTrabajo;
        this.propiedades = propiedades;
        this.qr = qr;
    }

    @GetMapping("/admin/configuracion")
    String configuracion(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        modelo.addAttribute("seccion", "configuracion");
        modelo.addAttribute("cfg", configuracion.resumen(localDeTrabajo.resolver(sesion, peticion)));
        return "admin/configuracion";
    }

    @PostMapping("/admin/configuracion")
    ResponseEntity<Void> guardarNegocio(@AuthenticationPrincipal Sesion sesion, @RequestParam String nombreComercial, @RequestParam String razonSocial,
                          @RequestParam(required = false) String ruc, @RequestParam(required = false) String rubro,
                          @RequestParam(required = false) String direccion, @RequestParam(required = false) String telefono,
                          HttpServletRequest peticion, HttpServletResponse respuesta) {
        configuracion.guardarNegocio(localDeTrabajo.resolver(sesion, peticion),
                new DatosNegocio(nombreComercial, razonSocial, ruc, rubro, direccion, telefono), Auditoria.Actor.de(sesion, peticion));
        return listo(peticion, respuesta, "Datos del local guardados", "/admin/configuracion");
    }

    @GetMapping("/admin/pantalla")
    String pantalla(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        var cfg = configuracion.resumen(localDeTrabajo.resolver(sesion, peticion));
        String url = propiedades.urlPublica() + "/l/" + cfg.local().slug();
        modelo.addAttribute("seccion", "pantalla");
        modelo.addAttribute("cfg", cfg);
        modelo.addAttribute("urlLocal", url);
        modelo.addAttribute("qrLocal", qr.svg(url, 220));
        modelo.addAttribute("qrAfiche", qr.svg(url, 420));
        // Enlace firmado: la TV muestra el PIN de presencia de las citas (M3) sin sesión
        modelo.addAttribute("claveTv", clavePantalla.de(cfg.local().id()));
        return "admin/pantalla";
    }

    @PostMapping("/admin/pantalla")
    ResponseEntity<Void> guardarPantalla(@AuthenticationPrincipal Sesion sesion, @RequestParam String colorPrimario, @RequestParam(required = false) String logoUrl,
                           @RequestParam(required = false) String mensajeTv, @RequestParam(required = false) String mensajeBienvenida,
                           @RequestParam(defaultValue = "2") int avisarFaltando, HttpServletRequest peticion, HttpServletResponse respuesta) {
        configuracion.guardarPantalla(localDeTrabajo.resolver(sesion, peticion),
                new DatosPantalla(colorPrimario, logoUrl, mensajeTv, mensajeBienvenida, avisarFaltando), Auditoria.Actor.de(sesion, peticion));
        return listo(peticion, respuesta, "Pantalla actualizada. La TV se refresca sola.", "/admin/pantalla");
    }

    /** Con htmx responde vacío (hx-swap="none") y muestra el aviso; sin JavaScript vuelve a la página. */
    private static ResponseEntity<Void> listo(HttpServletRequest peticion, HttpServletResponse respuesta, String mensaje, String pagina) {
        if (Htmx.esPeticion(peticion)) {
            Htmx.aviso(respuesta, Htmx.Tipo.EXITO, mensaje);
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.status(HttpStatus.SEE_OTHER).location(URI.create(pagina)).build();
    }
}
