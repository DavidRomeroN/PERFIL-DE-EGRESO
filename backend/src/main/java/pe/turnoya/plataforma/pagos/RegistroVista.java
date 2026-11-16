package pe.turnoya.plataforma.pagos;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

/** {@code /registro}: alta de un local con su administrador; en planes de pago, el primer mes con tarjeta. */
@Controller
class RegistroVista {

    private final RegistroPublico registro;

    RegistroVista(RegistroPublico registro) {
        this.registro = registro;
    }

    @GetMapping("/registro")
    String pagina(@RequestParam(required = false) String plan, Model modelo) {
        var planes = registro.planes();
        String elegido = planes.stream().map(p -> p.codigo()).filter(c -> c.equalsIgnoreCase(plan == null ? "" : plan)).findFirst()
                .orElse(planes.stream().anyMatch(p -> p.codigo().equals("EMPRENDE")) ? "EMPRENDE" : planes.isEmpty() ? "" : planes.get(0).codigo());
        modelo.addAttribute("planes", planes);
        modelo.addAttribute("planElegido", elegido);
        modelo.addAttribute("pagosHabilitados", registro.pagosHabilitados());
        modelo.addAttribute("clavePublica", registro.clavePublica());
        return "registro";
    }
}
