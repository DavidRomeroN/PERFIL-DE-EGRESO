package pe.turnoya.compartido.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import pe.turnoya.compartido.ErrorNegocio;

/**
 * Errores de negocio en las páginas: se muestran con la plantilla {@code error/negocio} y su estado HTTP.
 * Las rutas de la API los atiende antes {@link ManejadorErroresApi} (mayor precedencia).
 */
@ControllerAdvice(annotations = Controller.class)
@Order(Ordered.LOWEST_PRECEDENCE)
class ManejadorErroresVistas {

    private static final Logger log = LoggerFactory.getLogger(ManejadorErroresVistas.class);

    @ExceptionHandler(ErrorNegocio.class)
    String negocio(ErrorNegocio e, Model modelo, HttpServletRequest peticion, HttpServletResponse respuesta) {
        respuesta.setStatus(e.status());
        if (e.status() >= 500) {
            log.error("Error de negocio {}", e.codigo(), e);
        }
        // Acciones con htmx: el mensaje va como aviso (js/app.js lo muestra) y la pantalla no se reemplaza
        if (Htmx.esPeticion(peticion)) {
            Htmx.aviso(respuesta, Htmx.Tipo.ERROR, e.getMessage());
            return "fragmentos/base :: vacio";
        }
        modelo.addAttribute("codigo", e.codigo());
        modelo.addAttribute("mensaje", e.getMessage());
        modelo.addAttribute("status", e.status());
        return "error/negocio";
    }
}
