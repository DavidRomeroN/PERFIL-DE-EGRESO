package pe.turnoya.nucleo.web.vistas;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.web.Formatos;
import pe.turnoya.compartido.web.GeneradorQr;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.aplicacion.CancelacionTurnos;
import pe.turnoya.nucleo.aplicacion.EmisionTurnos;
import pe.turnoya.nucleo.aplicacion.InformacionLocal;
import pe.turnoya.nucleo.aplicacion.SolicitudEmision;
import pe.turnoya.nucleo.aplicacion.Valoraciones;

/**
 * Pantallas del cliente (sin cuenta, sin app): tomar turno por QR, seguir el turno y el ticket impreso.
 * Formularios HTML normales; htmx solo refresca las partes que cambian en vivo.
 */
@Controller
class ClienteVistas {

    private final InformacionLocal informacion;
    private final EmisionTurnos emision;
    private final ConsultaTurnos consulta;
    private final CancelacionTurnos cancelacion;
    private final Valoraciones valoraciones;
    private final LimitadorPeticiones limitador;
    private final PropiedadesTurnoYa propiedades;
    private final Formatos formatos;
    private final GeneradorQr qr;

    ClienteVistas(InformacionLocal informacion, EmisionTurnos emision, ConsultaTurnos consulta, CancelacionTurnos cancelacion,
                  Valoraciones valoraciones, LimitadorPeticiones limitador, PropiedadesTurnoYa propiedades, Formatos formatos,
                  GeneradorQr qr) {
        this.informacion = informacion;
        this.emision = emision;
        this.consulta = consulta;
        this.cancelacion = cancelacion;
        this.valoraciones = valoraciones;
        this.limitador = limitador;
        this.propiedades = propiedades;
        this.formatos = formatos;
        this.qr = qr;
    }

    // --- Tomar turno ------------------------------------------------------------------------------------------

    /** Paso 1: elegir el servicio. Con {@code ?cola=} (o si hay una sola cola) pasa al paso 2: los datos. */
    @GetMapping("/l/{slug}")
    String tomarTurno(@PathVariable String slug, @RequestParam(required = false) Integer cola, Model modelo) {
        InformacionLocal.LocalParaCliente local = informacion.porSlug(slug);
        modelo.addAttribute("local", local);
        modelo.addAttribute("cola", elegida(local, cola));
        return "cliente/tomar-turno";
    }

    /** Refresco en vivo de la lista de colas (cuántos esperan y la espera estimada). */
    @GetMapping("/l/{slug}/colas")
    String colasEnVivo(@PathVariable String slug, Model modelo) {
        modelo.addAttribute("local", informacion.porSlug(slug));
        return "cliente/tomar-turno :: colas";
    }

    @PostMapping("/l/{slug}/turno")
    String emitir(@PathVariable String slug, @RequestParam int colaId, @RequestParam(required = false) String nombre,
                  @RequestParam(required = false) String telefono, @RequestParam(defaultValue = "false") boolean consentimiento,
                  @RequestParam(required = false) String categoria, HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        InformacionLocal.LocalParaCliente local = informacion.porSlug(slug);
        try {
            if (!limitador.permitir("turnos", IpCliente.de(peticion), 5)) {
                throw new ErrorNegocio("RATE_LIMIT", "Demasiadas solicitudes. Intenta en un minuto.", 429);
            }
            if (local.cola(colaId) == null) {
                throw ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe o está inactiva");
            }
            TurnoPublico turno = emision.emitir(SolicitudEmision.porQr(colaId, nombre, telefono, consentimiento, vacioANulo(categoria)));
            return "redirect:/t/" + turno.token();
        } catch (ErrorNegocio e) {
            respuesta.setStatus(e.status());
            modelo.addAttribute("local", local);
            modelo.addAttribute("cola", local.cola(colaId));
            modelo.addAttribute("error", e.getMessage());
            modelo.addAttribute("duplicado", "TURNO_DUPLICADO".equals(e.codigo()) ? e.extra() : null);
            modelo.addAttribute("datos", new DatosFormulario(nombre, telefono, consentimiento, categoria));
            return "cliente/tomar-turno";
        }
    }

    // --- Mi turno ---------------------------------------------------------------------------------------------

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

    // --- Ticket impreso (RF07) --------------------------------------------------------------------------------

    @GetMapping("/ticket/{token}")
    String ticket(@PathVariable String token, Model modelo) {
        modelo.addAttribute("turno", consulta.porToken(token));
        String url = propiedades.urlPublica() + "/t/" + token;
        modelo.addAttribute("urlSeguimiento", url);
        modelo.addAttribute("qrSvg", qr.svg(url, 120));
        return "cliente/ticket";
    }

    private void cargarTurno(TurnoPublico turno, Model modelo) {
        modelo.addAttribute("turno", turno);
        modelo.addAttribute("valorado", turno.estado() == EstadoTurno.ATENDIDO && valoraciones.existe(turno.id()));
        // HTML de cada aviso (negritas de WhatsApp) ya escapado: la plantilla solo lo inserta
        modelo.addAttribute("avisosHtml", turno.notificaciones().stream()
                .collect(java.util.stream.Collectors.toMap(n -> n.id(), n -> formatos.whatsapp(n.mensaje()))));
    }

    private static InformacionLocal.ColaParaCliente elegida(InformacionLocal.LocalParaCliente local, Integer colaId) {
        if (colaId != null) {
            return local.cola(colaId);
        }
        return local.colas().size() == 1 ? local.colas().getFirst() : null;
    }

    private static String vacioANulo(String texto) {
        return texto == null || texto.isBlank() ? null : texto;
    }
}
