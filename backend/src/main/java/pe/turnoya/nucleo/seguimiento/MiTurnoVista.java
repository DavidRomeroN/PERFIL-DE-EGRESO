package pe.turnoya.nucleo.seguimiento;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.stream.Collectors;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.Formatos;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.TurnoPublico;

/** Página "mi turno" del cliente: posición en vivo, cancelar y valorar la atención. */
@Controller
class MiTurnoVista {

    private final ConsultaTurnos consulta;
    private final CancelacionTurnos cancelacion;
    private final Valoraciones valoraciones;
    private final LimitadorPeticiones limitador;
    private final Formatos formatos;

    MiTurnoVista(ConsultaTurnos consulta, CancelacionTurnos cancelacion, Valoraciones valoraciones, LimitadorPeticiones limitador,
                 Formatos formatos) {
        this.consulta = consulta;
        this.cancelacion = cancelacion;
        this.valoraciones = valoraciones;
        this.limitador = limitador;
        this.formatos = formatos;
    }

    @GetMapping("/t/{token}")
    String miTurno(@PathVariable String token, Model modelo) {
        TurnoPublico turno = consulta.porToken(token);
        // M6: un turno transferido lleva al turno nuevo (el enlace del cliente sigue sirviendo)
        if (turno.estado() == EstadoTurno.TRANSFERIDO && turno.redirigidoA() != null) {
            return "redirect:/t/" + turno.redirigidoA().token();
        }
        cargarTurno(turno, modelo);
        return "cliente/mi-turno";
    }

    @GetMapping("/t/{token}/tarjeta")
    String tarjeta(@PathVariable String token, Model modelo) {
        cargarTurno(consulta.porToken(token), modelo);
        return "cliente/mi-turno :: tarjeta";
    }

    @PostMapping("/t/{token}/cancelar")
    String cancelar(@PathVariable String token, HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        TurnoPublico turno = cancelacion.cancelar(token);
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/t/" + token;
        }
        cargarTurno(turno, modelo);
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Turno cancelado");
        return "cliente/mi-turno :: tarjeta";
    }

    @PostMapping("/t/{token}/valoracion")
    String valorar(@PathVariable String token, @RequestParam int estrellas, @RequestParam(required = false) String comentario,
                   HttpServletRequest peticion, HttpServletResponse respuesta) {
        if (estrellas < 1 || estrellas > 5) {
            throw new ErrorNegocio("VALIDACION", "estrellas: entre 1 y 5", 422);
        }
        if (!limitador.permitir("valoracion", IpCliente.de(peticion), 6)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiadas solicitudes.", 429);
        }
        valoraciones.valorar(token, estrellas, comentario);
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/t/" + token;
        }
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Gracias por tu valoración");
        return "cliente/mi-turno :: gracias";
    }

    private void cargarTurno(TurnoPublico turno, Model modelo) {
        modelo.addAttribute("turno", turno);
        modelo.addAttribute("valorado", turno.estado() == EstadoTurno.ATENDIDO && valoraciones.existe(turno.id()));
        // HTML de cada aviso (negritas de WhatsApp) ya escapado: la plantilla solo lo inserta
        modelo.addAttribute("avisosHtml", turno.notificaciones().stream()
                .collect(Collectors.toMap(n -> n.id(), n -> formatos.whatsapp(n.mensaje()))));
    }
}
