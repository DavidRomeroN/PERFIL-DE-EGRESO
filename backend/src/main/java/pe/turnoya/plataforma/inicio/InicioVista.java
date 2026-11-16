package pe.turnoya.plataforma.inicio;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import pe.turnoya.plataforma.planes.GestionPlanes;

/**
 * Página de inicio pública: qué es TurnoYa, cómo funciona, para qué negocio sirve cada plan y los precios. No muestra
 * locales ni cuentas (las cuentas de prueba solo aparecen en el login del perfil {@code dev}).
 */
@Controller
class InicioVista {

    private final GestionPlanes planes;

    InicioVista(GestionPlanes planes) {
        this.planes = planes;
    }

    @GetMapping("/")
    String inicio(Model modelo) {
        var catalogo = planes.listar();
        modelo.addAttribute("planes", catalogo);
        modelo.addAttribute("gratis", catalogo.stream().filter(p -> p.precioMensual().signum() == 0).findFirst().orElse(null));
        return "inicio";
    }
}
