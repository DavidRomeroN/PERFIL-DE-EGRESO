package pe.turnoya.nucleo.web.vistas;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.aplicacion.EmisionTurnos;
import pe.turnoya.nucleo.aplicacion.OperacionVentanilla;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloPersonal;

/**
 * Panel de ventanilla (RF05, RF06, RF07). Cada acción devuelve el panel actualizado (htmx lo reemplaza) y un aviso;
 * el resto de cambios llega por SSE. La ventanilla elegida se recuerda en una cookie del dispositivo.
 */
@Controller
@SoloPersonal
class PanelVista {

    private static final String COOKIE_VENTANILLA = "turnoya_ventanilla";

    private final ConsultaTurnos consulta;
    private final OperacionVentanilla operacion;
    private final EmisionTurnos emision;
    private final CatalogoLocales locales;

    PanelVista(ConsultaTurnos consulta, OperacionVentanilla operacion, EmisionTurnos emision, CatalogoLocales locales) {
        this.consulta = consulta;
        this.operacion = operacion;
        this.emision = emision;
        this.locales = locales;
    }

    @GetMapping("/panel")
    String panel(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String slug,
                 @RequestParam(required = false) Integer ventanilla, HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        Local local = localDelPanel(sesion, slug);
        Integer elegida = ventanilla != null ? ventanilla : recordada(peticion, local.slug()).orElse(null);
        if (ventanilla != null) {
            ResponseCookie cookie = ResponseCookie.from(COOKIE_VENTANILLA, local.slug() + ":" + ventanilla)
                    .path("/").maxAge(60L * 60 * 24 * 365).sameSite("Lax").httpOnly(true).build();
            respuesta.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
        }
        cargar(sesion, local, elegida, modelo);
        return "panel/panel";
    }

    @GetMapping("/panel/contenido")
    String contenido(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String slug,
                     @RequestParam(required = false) Integer ventanilla, Model modelo) {
        cargar(sesion, localDelPanel(sesion, slug), ventanilla, modelo);
        return "panel/panel :: contenido";
    }

    @PostMapping("/panel/llamar")
    String llamar(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String slug, @RequestParam int ventanilla,
                  HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        Local local = localDelPanel(sesion, slug);
        Optional<TurnoPublico> llamado = operacion.llamarSiguiente(ventanilla, local.id(), Auditoria.Actor.de(sesion, peticion));
        if (llamado.isPresent()) {
            Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Llamando a " + llamado.get().codigo(), Map.of("sonido", true));
        } else {
            Htmx.aviso(respuesta, Htmx.Tipo.INFO, "No hay turnos en espera");
        }
        return fragmentoOPanel(sesion, local, ventanilla, peticion, modelo);
    }

    @PostMapping("/panel/turnos/{id}/estado")
    String cambiarEstado(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam EstadoTurno estado,
                         @RequestParam(required = false) String slug, @RequestParam(required = false) Integer ventanilla,
                         HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        Local local = localDelPanel(sesion, slug);
        if (estado != EstadoTurno.LLAMADO && estado != EstadoTurno.ATENDIDO && estado != EstadoTurno.NO_SE_PRESENTO) {
            throw new ErrorNegocio("VALIDACION", "Acción no válida desde el panel", 422);
        }
        operacion.cambiarEstado(id, local.id(), estado, Auditoria.Actor.de(sesion, peticion));
        switch (estado) {
            case LLAMADO -> Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Rellamando…", Map.of("sonido", true));
            case ATENDIDO -> Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Marcado como atendido");
            default -> Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Marcado como no se presentó");
        }
        return fragmentoOPanel(sesion, local, ventanilla, peticion, modelo);
    }

    /** RF07: ticket impreso. El navegador abre la ventana de impresión con el evento {@code abrirVentana}. */
    @PostMapping("/panel/ticket")
    String ticket(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String slug, @RequestParam int colaId,
                  @RequestParam(required = false) String nombre, @RequestParam(required = false) Integer ventanilla,
                  HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        Local local = localDelPanel(sesion, slug);
        TurnoPublico t = emision.emitirTicket(local.id(), colaId, nombre == null || nombre.isBlank() ? null : nombre.trim(), null);
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Ticket " + t.codigo() + " emitido", Map.of("abrirVentana", "/ticket/" + t.token()));
        return fragmentoOPanel(sesion, local, ventanilla, peticion, modelo);
    }

    /** Con htmx se devuelve solo el panel actualizado; con un formulario normal se vuelve a la página del panel. */
    private String fragmentoOPanel(Sesion sesion, Local local, Integer ventanilla, HttpServletRequest peticion, Model modelo) {
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/panel?slug=" + local.slug() + (ventanilla == null ? "" : "&ventanilla=" + ventanilla);
        }
        cargar(sesion, local, ventanilla, modelo);
        return "panel/panel :: contenido";
    }

    private void cargar(Sesion sesion, Local local, Integer ventanilla, Model modelo) {
        List<PanelModelo.OpcionLocal> opciones = sesion.esSuperAdmin()
                ? locales.activos().stream().map(l -> new PanelModelo.OpcionLocal(l.slug(), l.nombreComercial())).toList()
                : List.of();
        modelo.addAttribute("p", PanelModelo.de(consulta.snapshot(local, true), ventanilla, opciones));
    }

    private Local localDelPanel(Sesion sesion, String slug) {
        if (sesion.esSuperAdmin()) {
            if (slug != null && !slug.isBlank()) {
                return locales.activoPorSlug(slug);
            }
            return locales.activos().stream().findFirst().orElseThrow(() -> new ErrorNegocio("SIN_LOCAL", "No hay locales registrados", 400));
        }
        if (sesion.localSlug() == null) {
            throw new ErrorNegocio("SIN_LOCAL", "El usuario no tiene un local asignado", 400);
        }
        return locales.activoPorSlug(sesion.localSlug());
    }

    private static Optional<Integer> recordada(HttpServletRequest peticion, String slug) {
        if (peticion.getCookies() == null) {
            return Optional.empty();
        }
        return Arrays.stream(peticion.getCookies())
                .filter(c -> COOKIE_VENTANILLA.equals(c.getName()))
                .map(Cookie::getValue)
                .filter(v -> v.startsWith(slug + ":"))
                .map(v -> v.substring(slug.length() + 1))
                .filter(v -> v.matches("\\d{1,9}"))
                .map(Integer::valueOf)
                .findFirst();
    }
}
