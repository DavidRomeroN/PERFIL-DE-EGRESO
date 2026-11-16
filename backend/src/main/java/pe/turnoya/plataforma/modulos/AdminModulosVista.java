package pe.turnoya.plataforma.modulos;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** Página {@code /admin/modulos}: tarjetas con el interruptor de cada módulo. Al cambiar, recarga para actualizar el menú. */
@Controller
@SoloAdmin
class AdminModulosVista {

    private final HubModulos hub;
    private final LocalDeTrabajo localDeTrabajo;

    AdminModulosVista(HubModulos hub, LocalDeTrabajo localDeTrabajo) {
        this.hub = hub;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/admin/modulos")
    String pagina(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modelo.addAttribute("seccion", "modulos");
        modelo.addAttribute("plan", hub.nombrePlan(localId));
        modelo.addAttribute("modulos", hub.estado(localId));
        return "admin/modulos";
    }

    @PostMapping("/admin/modulos/{codigo}")
    ResponseEntity<Void> cambiar(@AuthenticationPrincipal Sesion sesion, @PathVariable String codigo, @RequestParam(defaultValue = "false") boolean habilitado,
                   HttpServletRequest peticion, HttpServletResponse respuesta) {
        var estado = hub.cambiar(localDeTrabajo.resolver(sesion, peticion), codigo, habilitado, Auditoria.Actor.de(sesion, peticion));
        String nombre = estado.stream().filter(m -> m.codigo().equals(codigo)).findFirst().map(HubModulos.EstadoModulo::nombre).orElse(codigo);
        if (Htmx.esPeticion(peticion)) {
            // El menú lateral muestra los módulos activos: se recarga la página completa
            Htmx.aviso(respuesta, Htmx.Tipo.EXITO, nombre + (habilitado ? " activado" : " desactivado"));
            respuesta.setHeader("HX-Refresh", "true");
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.status(HttpStatus.SEE_OTHER).location(URI.create("/admin/modulos")).build();
    }
}
