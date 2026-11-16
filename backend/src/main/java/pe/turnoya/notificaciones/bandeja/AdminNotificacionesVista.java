package pe.turnoya.notificaciones.bandeja;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.HashMap;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.Formatos;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.notificaciones.dominio.GatewayOpenWa;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/**
 * Página {@code /admin/notificaciones}: indicadores, bandeja de salida (se refresca con los eventos en vivo) y la
 * conexión del número propio por OpenWA (el QR se refresca solo mientras se espera el escaneo).
 */
@Controller
@SoloAdmin
class AdminNotificacionesVista {

    private final BandejaAvisos bandeja;
    private final LocalDeTrabajo localDeTrabajo;
    private final Formatos formatos;

    AdminNotificacionesVista(BandejaAvisos bandeja, LocalDeTrabajo localDeTrabajo, Formatos formatos) {
        this.bandeja = bandeja;
        this.localDeTrabajo = localDeTrabajo;
        this.formatos = formatos;
    }

    @GetMapping("/admin/notificaciones")
    String pagina(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        var local = localDeTrabajo.local(sesion, peticion);
        var datos = bandeja.bandeja(local.id(), 80);
        modelo.addAttribute("seccion", "notificaciones");
        modelo.addAttribute("slug", local.slug());
        cargarBandeja(datos, modelo);
        modelo.addAttribute("conexion", "meta".equals(datos.proveedor()) ? null : bandeja.estadoConexion(local.id()));
        return "admin/notificaciones";
    }

    @GetMapping("/admin/notificaciones/bandeja")
    String bandejaFragmento(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        cargarBandeja(bandeja.bandeja(localDeTrabajo.resolver(sesion, peticion), 80), modelo);
        return "admin/notificaciones :: bandeja";
    }

    /** El texto con *negritas* se convierte aquí (th:utext no puede llamar a beans en Thymeleaf 3.1). */
    private void cargarBandeja(BandejaAvisos.Bandeja datos, Model modelo) {
        Map<Integer, String> html = new HashMap<>();
        datos.notificaciones().forEach(n -> html.put(n.id(), formatos.whatsapp(n.mensaje())));
        modelo.addAttribute("datos", datos);
        modelo.addAttribute("mensajesHtml", html);
    }

    @GetMapping("/admin/notificaciones/conexion")
    String conexion(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        modelo.addAttribute("conexion", bandeja.estadoConexion(localDeTrabajo.resolver(sesion, peticion)));
        return "admin/notificaciones :: conexion";
    }

    @PostMapping("/admin/notificaciones/conexion")
    String accion(@AuthenticationPrincipal Sesion sesion, @RequestParam String accion, @RequestParam(required = false) String telefono,
                  HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        GatewayOpenWa.Estado estado;
        try {
            estado = bandeja.accion(localDeTrabajo.resolver(sesion, peticion), accion, telefono, Auditoria.Actor.de(sesion, peticion));
        } catch (GatewayOpenWa.ErrorOpenWa e) {
            throw new ErrorNegocio("OPENWA", e.getMessage(), 502);
        }
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, switch (accion) {
            case "prueba" -> "Mensaje de prueba enviado";
            case "iniciar" -> "Sesión iniciada: escanea el QR";
            case "numero" -> "Número guardado";
            case "codigo" -> "Código listo: escríbelo en WhatsApp";
            default -> "Listo";
        });
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/admin/notificaciones";
        }
        modelo.addAttribute("conexion", estado);
        return "admin/notificaciones :: conexion";
    }
}
