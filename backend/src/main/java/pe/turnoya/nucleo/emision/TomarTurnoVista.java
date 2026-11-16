package pe.turnoya.nucleo.emision;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.nucleo.TurnoPublico;

/**
 * Pantalla del cliente para tomar turno por QR (sin cuenta, sin app). Formulario HTML normal; htmx solo refresca
 * la lista de colas en vivo.
 */
@Controller
class TomarTurnoVista {

    private final InformacionLocal informacion;
    private final EmisionTurnos emision;
    private final LimitadorPeticiones limitador;

    TomarTurnoVista(InformacionLocal informacion, EmisionTurnos emision, LimitadorPeticiones limitador) {
        this.informacion = informacion;
        this.emision = emision;
        this.limitador = limitador;
    }

    /** Paso 1: elegir el servicio. Con {@code ?cola=} (o si hay una sola cola) pasa al paso 2: los datos. */
    @GetMapping("/l/{slug}")
    String tomarTurno(@PathVariable String slug, @RequestParam(required = false) Integer cola, Model modelo) {
        InformacionLocal.LocalParaCliente local = informacion.porSlug(slug);
        modelo.addAttribute("local", local);
        modelo.addAttribute("cola", elegida(local, cola));
        return "cliente/tomar-turno";
    }

    /**
     * Destino del QR "app" de la TV cuando se escanea con la cámara: abre la app TurnoYa ({@code turnoya://l/<slug>})
     * o, si no la tiene, permite seguir en la web por QR.
     */
    @GetMapping("/l/{slug}/app")
    String abrirApp(@PathVariable String slug, @RequestParam(name = "p", required = false) String marca, Model modelo) {
        modelo.addAttribute("local", informacion.porSlug(slug));
        // La marca de presencia del QR pasa a la app tal cual; solo se acepta su formato (base36 + firma URL-safe)
        modelo.addAttribute("presencia", marca != null && marca.matches("[A-Za-z0-9._-]{4,64}") ? marca : null);
        return "cliente/abrir-app";
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
