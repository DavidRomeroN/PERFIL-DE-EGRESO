package pe.turnoya.nucleo.pantalla;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.nucleo.dominio.Cola;
import pe.turnoya.nucleo.dominio.RepositorioColas;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.ClavePantalla;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/**
 * Bloque "Pantallas por sala" de {@code /admin/pantalla}: un enlace de TV con todas las colas, uno por cola (salen de
 * las colas activas) y las salas combinadas que guarda el administrador, que se pueden eliminar. La sala va en el
 * enlace ({@code ?colas=1,3}).
 */
@Controller
@SoloAdmin
class AdminSalasTvVista {

    private static final String RUTA = "/admin/pantalla/salas";

    private final RepositorioColas colas;
    private final GestionSalasTv salas;
    private final CatalogoLocales locales;
    private final LocalDeTrabajo localDeTrabajo;
    private final ClavePantalla clavePantalla;
    private final PropiedadesTurnoYa propiedades;

    AdminSalasTvVista(RepositorioColas colas, GestionSalasTv salas, CatalogoLocales locales, LocalDeTrabajo localDeTrabajo, ClavePantalla clavePantalla,
                      PropiedadesTurnoYa propiedades) {
        this.colas = colas;
        this.salas = salas;
        this.locales = locales;
        this.localDeTrabajo = localDeTrabajo;
        this.clavePantalla = clavePantalla;
        this.propiedades = propiedades;
    }

    /** Fila de la tabla; {@code salaId} solo en las salas guardadas (las que se pueden eliminar). */
    record Enlace(String nombre, String detalle, String url, Integer salaId) {
    }

    @GetMapping(RUTA)
    String bloque(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        return cargar(localDeTrabajo.resolver(sesion, peticion), modelo);
    }

    @PostMapping(RUTA)
    String crear(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) List<Integer> colas,
                 @RequestParam(required = false) String nombre, HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        try {
            var sala = salas.crear(localId, nombre, colas, Auditoria.Actor.de(sesion, peticion));
            Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Pantalla «" + sala.nombre() + "» creada");
        } catch (ErrorNegocio e) {
            modelo.addAttribute("error", e.getMessage());
            modelo.addAttribute("nombreEscrito", nombre);
            modelo.addAttribute("marcadas", colas == null ? List.of() : colas);
        }
        return cargar(localId, modelo);
    }

    @PostMapping(RUTA + "/{id}/eliminar")
    String eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, HttpServletResponse respuesta,
                    Model modelo) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        try {
            var sala = salas.eliminar(localId, id, Auditoria.Actor.de(sesion, peticion));
            Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Pantalla «" + sala.nombre() + "» eliminada");
        } catch (ErrorNegocio e) {
            modelo.addAttribute("error", e.getMessage());
        }
        return cargar(localId, modelo);
    }

    private String cargar(int localId, Model modelo) {
        Local local = locales.exigir(localId);
        List<Cola> activas = this.colas.activasDelLocal(local.id());
        Map<Integer, Cola> porId = activas.stream().collect(Collectors.toMap(Cola::id, Function.identity()));
        String base = propiedades.urlPublica() + "/l/" + local.slug() + "/tv?k=" + clavePantalla.de(local.id());

        List<Enlace> guardadas = new ArrayList<>();
        for (var s : salas.delLocal(local.id())) {
            // Si alguna cola se desactivó, la sala sigue con las que quedan; sin ninguna, solo se puede eliminar
            List<Cola> vigentes = s.colaIds().stream().map(porId::get).filter(c -> c != null).toList();
            String detalle = vigentes.isEmpty() ? "Sus colas ya no están activas"
                    : "Sala combinada · " + vigentes.stream().map(Cola::nombre).collect(Collectors.joining(", "));
            String url = vigentes.isEmpty() ? null
                    : base + "&colas=" + vigentes.stream().map(c -> String.valueOf(c.id())).collect(Collectors.joining(","));
            guardadas.add(new Enlace(s.nombre(), detalle, url, s.id()));
        }

        List<Enlace> automaticas = new ArrayList<>();
        automaticas.add(new Enlace("Todo el local", activas.size() == 1 ? activas.getFirst().nombre() : "Todas las colas", base, null));
        if (activas.size() > 1) {
            for (Cola c : activas) {
                automaticas.add(new Enlace(c.nombre(), "Solo esta cola", base + "&colas=" + c.id(), null));
            }
        }

        modelo.addAttribute("colas", activas);
        if (!modelo.containsAttribute("marcadas")) {
            modelo.addAttribute("marcadas", List.of());
        }
        modelo.addAttribute("guardadas", guardadas);
        modelo.addAttribute("enlaces", automaticas);
        modelo.addAttribute("maxNombre", GestionSalasTv.MAX_NOMBRE);
        return "admin/pantalla-salas :: bloque";
    }
}
