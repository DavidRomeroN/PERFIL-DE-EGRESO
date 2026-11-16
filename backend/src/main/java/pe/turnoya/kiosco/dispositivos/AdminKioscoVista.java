package pe.turnoya.kiosco.dispositivos;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.kiosco.operacion.OperacionKiosco;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** {@code /admin/modulos/kiosco}: dispositivos (crear, rotar, revocar) y cola de sincronización con resolución de conflictos. */
@Controller
@SoloAdmin
class AdminKioscoVista {

    private static final String RUTA = "/admin/modulos/kiosco";

    private final GestionKioscos gestion;
    private final OperacionKiosco operacion;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;
    private final Auditoria auditoria;

    AdminKioscoVista(GestionKioscos gestion, OperacionKiosco operacion, LocalDeTrabajo localDeTrabajo, ModulosLocal modulos, Auditoria auditoria) {
        this.gestion = gestion;
        this.operacion = operacion;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
        this.auditoria = auditoria;
    }

    @GetMapping(RUTA)
    String pagina(@AuthenticationPrincipal Sesion sesion, @RequestParam(defaultValue = "dispositivos") String tab,
                  @RequestParam(defaultValue = "REVISION") String estado, HttpServletRequest peticion, Model modelo) {
        int localId = local(sesion, peticion);
        modelo.addAttribute("seccion", "M5");
        modelo.addAttribute("tab", tab);
        modelo.addAttribute("estado", estado);
        modelo.addAttribute("estados", List.of("REVISION", "APLICADO", "DUPLICADO", "RECHAZADO"));
        if ("eventos".equals(tab)) {
            modelo.addAttribute("eventos", operacion.eventos(localId, estado, null, null).items());
        } else {
            modelo.addAttribute("dispositivos", gestion.listar(localId));
        }
        return "modulos/kiosco";
    }

    @PostMapping(RUTA + "/dispositivos")
    String crear(@AuthenticationPrincipal Sesion sesion, @RequestParam String nombre, HttpServletRequest peticion, RedirectAttributes flash) {
        try {
            var r = gestion.crear(local(sesion, peticion), nombre, List.of(), Auditoria.Actor.de(sesion, peticion));
            flash.addFlashAttribute("codigo", Map.of("codigo", r.codigo(), "expira", r.expira(), "pin", r.pinMantenimiento()));
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        }
        return "redirect:" + RUTA;
    }

    @PostMapping(RUTA + "/dispositivos/{id}/rotar")
    String rotar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, RedirectAttributes flash) {
        var c = gestion.rotar(local(sesion, peticion), id, Auditoria.Actor.de(sesion, peticion));
        flash.addFlashAttribute("codigo", Map.of("codigo", c.codigo(), "expira", c.expira()));
        return "redirect:" + RUTA;
    }

    @PostMapping(RUTA + "/dispositivos/{id}/revocar")
    String revocar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, RedirectAttributes flash) {
        gestion.editar(local(sesion, peticion), id, null, null, false, null, Auditoria.Actor.de(sesion, peticion));
        flash.addFlashAttribute("mensaje", "Kiosco revocado");
        return "redirect:" + RUTA;
    }

    @PostMapping(RUTA + "/eventos/{id}/resolver")
    String resolver(@AuthenticationPrincipal Sesion sesion, @PathVariable long id, @RequestParam String accion, HttpServletRequest peticion,
                    RedirectAttributes flash) {
        int localId = local(sesion, peticion);
        try {
            var r = operacion.resolver(localId, id, accion, sesion.sub());
            auditoria.registrar(Auditoria.Actor.de(sesion, peticion), localId, "KIOSCO_RESOLVER", "evento_kiosco", id,
                    "DESCARTAR".equals(accion) ? "Descartó un evento del kiosco" : "Emitió un turno pendiente del kiosco", Map.of("accion", accion));
            flash.addFlashAttribute("mensaje", r.turno() != null ? "Turno " + r.turno().codigo() + " emitido" : "Evento descartado");
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        }
        return "redirect:" + RUTA + "?tab=eventos";
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modulos.exigir(localId, Modulo.M5);
        return localId;
    }
}
