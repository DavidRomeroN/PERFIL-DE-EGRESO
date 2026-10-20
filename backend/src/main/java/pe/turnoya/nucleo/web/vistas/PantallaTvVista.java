package pe.turnoya.nucleo.web.vistas;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.web.GeneradorQr;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;

/** Pantalla TV de la sala de espera (RF12): llamado en grande, colas, en atención y QR para tomar turno. */
@Controller
class PantallaTvVista {

    private final ConsultaTurnos consulta;
    private final CatalogoLocales locales;
    private final PropiedadesTurnoYa propiedades;
    private final GeneradorQr qr;

    PantallaTvVista(ConsultaTurnos consulta, CatalogoLocales locales, PropiedadesTurnoYa propiedades, GeneradorQr qr) {
        this.consulta = consulta;
        this.locales = locales;
        this.propiedades = propiedades;
        this.qr = qr;
    }

    @GetMapping("/l/{slug}/tv")
    String pantalla(@PathVariable String slug, Model modelo) {
        cargar(slug, modelo);
        return "tv/pantalla";
    }

    @GetMapping("/l/{slug}/tv/contenido")
    String contenido(@PathVariable String slug, Model modelo) {
        cargar(slug, modelo);
        return "tv/pantalla :: contenido";
    }

    private void cargar(String slug, Model modelo) {
        Local local = locales.activoPorSlug(slug);
        modelo.addAttribute("snap", consulta.snapshot(local, false));
        String urlLocal = propiedades.urlPublica() + "/l/" + slug;
        modelo.addAttribute("urlLocal", urlLocal);
        modelo.addAttribute("qrSvg", qr.svg(urlLocal, 128));
    }
}
