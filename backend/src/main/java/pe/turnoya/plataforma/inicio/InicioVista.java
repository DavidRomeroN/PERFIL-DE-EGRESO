package pe.turnoya.plataforma.inicio;

import java.util.List;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.dominio.RepositorioLocales;
import pe.turnoya.plataforma.planes.GestionPlanes;

/** Página de inicio: qué es TurnoYa, cómo funciona, demo con los locales activos y los planes. */
@Controller
class InicioVista {

    /** Cuentas del seed de demostración (rol, correo, contraseña, destino). */
    private static final List<List<String>> CUENTAS_DEMO = List.of(
            List.of("Super admin TurnoYa", "superadmin@turnoya.pe", "admin123", "/admin/locales"),
            List.of("Admin · Policlínico", "admin@policlinico.pe", "admin123", "/admin"),
            List.of("Operador · Policlínico", "operador@policlinico.pe", "operador123", "/panel"),
            List.of("Admin · Transportes", "admin@transportes.pe", "admin123", "/admin"));

    private final CatalogoLocales locales;
    private final GestionPlanes planes;
    private final RepositorioLocales repositorio;

    InicioVista(CatalogoLocales locales, GestionPlanes planes, RepositorioLocales repositorio) {
        this.locales = locales;
        this.planes = planes;
        this.repositorio = repositorio;
    }

    @GetMapping("/")
    String inicio(Model modelo) {
        var activos = locales.activos();
        var catalogo = planes.listar();
        modelo.addAttribute("locales", activos);
        modelo.addAttribute("demo", activos.isEmpty() ? null : activos.get(0));
        modelo.addAttribute("planes", catalogo);
        modelo.addAttribute("gratis", catalogo.stream().filter(p -> p.precioMensual().signum() == 0).findFirst().orElse(null));
        modelo.addAttribute("totalTurnos", repositorio.turnosRegistrados());
        modelo.addAttribute("cuentas", CUENTAS_DEMO);
        return "inicio";
    }
}
