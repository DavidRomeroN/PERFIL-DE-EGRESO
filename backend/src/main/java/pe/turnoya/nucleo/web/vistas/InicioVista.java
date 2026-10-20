package pe.turnoya.nucleo.web.vistas;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import pe.turnoya.plataforma.CatalogoLocales;

/** Página de inicio: qué es TurnoYa y accesos al ingreso y a los locales de demostración. */
@Controller
class InicioVista {

    private final CatalogoLocales locales;

    InicioVista(CatalogoLocales locales) {
        this.locales = locales;
    }

    @GetMapping("/")
    String inicio(Model modelo) {
        modelo.addAttribute("locales", locales.activos().stream().limit(6).toList());
        return "inicio";
    }
}
