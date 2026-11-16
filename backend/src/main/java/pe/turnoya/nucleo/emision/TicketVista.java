package pe.turnoya.nucleo.emision;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.web.GeneradorQr;
import pe.turnoya.nucleo.ConsultaTurnos;

/** Ticket impreso de 80 mm (RF07) para quien no tiene celular, con el QR para seguir el turno. */
@Controller
class TicketVista {

    private final ConsultaTurnos consulta;
    private final PropiedadesTurnoYa propiedades;
    private final GeneradorQr qr;

    TicketVista(ConsultaTurnos consulta, PropiedadesTurnoYa propiedades, GeneradorQr qr) {
        this.consulta = consulta;
        this.propiedades = propiedades;
        this.qr = qr;
    }

    @GetMapping("/ticket/{token}")
    String ticket(@PathVariable String token, Model modelo) {
        modelo.addAttribute("turno", consulta.porToken(token));
        String url = propiedades.urlPublica() + "/t/" + token;
        modelo.addAttribute("urlSeguimiento", url);
        modelo.addAttribute("qrSvg", qr.svg(url, 120));
        return "cliente/ticket";
    }
}
