package pe.turnoya.citas.administracion;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.LocalDate;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;
import pe.turnoya.citas.checkin.CheckinCitas;
import pe.turnoya.citas.dominio.RepositorioCitas.ConfigCitas;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.SoloPersonal;

/** {@code /admin/modulos/citas}: agenda del día con acciones, configuración por servicio y bloqueos (feriados y clientes). */
@Controller
class AdminCitasVista {

    private static final String RUTA = "/admin/modulos/citas";

    private final GestionCitas gestion;
    private final CheckinCitas checkin;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;

    AdminCitasVista(GestionCitas gestion, CheckinCitas checkin, LocalDeTrabajo localDeTrabajo, ModulosLocal modulos) {
        this.gestion = gestion;
        this.checkin = checkin;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
    }

    @GetMapping(RUTA)
    @SoloAdmin
    String pagina(@AuthenticationPrincipal Sesion sesion, @RequestParam(defaultValue = "agenda") String tab, @RequestParam(required = false) String fecha,
                  @RequestParam(required = false) Integer colaId, HttpServletRequest peticion, Model modelo) {
        var local = localDeTrabajo.local(sesion, peticion);
        modulos.exigir(local.id(), Modulo.M3);
        modelo.addAttribute("seccion", "M3");
        modelo.addAttribute("tab", tab);
        modelo.addAttribute("slug", local.slug());
        modelo.addAttribute("configs", gestion.configuraciones(local.id(), null));
        modelo.addAttribute("pin", checkin.pinActual(local.id()));
        switch (tab) {
            case "config" -> modelo.addAttribute("colaElegida", colaId);
            case "bloqueos" -> modelo.addAttribute("bloqueos", gestion.bloqueos(local.id()));
            default -> agenda(local.id(), fecha, colaId, modelo);
        }
        return "modulos/citas";
    }

    @PostMapping(RUTA + "/{id}/accion")
    @SoloAdmin
    String accion(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam String accion, @RequestParam(required = false) Integer slotId,
                  @RequestParam(required = false) String fecha, @RequestParam(required = false) Integer colaId, HttpServletRequest peticion,
                  HttpServletResponse respuesta, Model modelo) {
        int localId = local(sesion, peticion);
        try {
            gestion.accion(localId, id, CitasApi.accion(accion), slotId, "usuario:" + sesion.sub());
            Htmx.aviso(respuesta, Htmx.Tipo.EXITO, switch (accion) {
                case "CANCELAR" -> "Cita cancelada";
                case "MOVER" -> "Cita movida";
                case "NO_SHOW" -> "Marcada como inasistencia";
                default -> "Marcada como atendida";
            });
        } catch (ErrorNegocio e) {
            Htmx.aviso(respuesta, Htmx.Tipo.ERROR, e.getMessage());
        }
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:" + RUTA + (fecha == null ? "" : "?fecha=" + fecha);
        }
        agenda(localId, fecha, colaId, modelo);
        return "modulos/citas :: agenda";
    }

    @PostMapping(RUTA + "/config")
    @SoloAdmin
    String guardarConfig(@AuthenticationPrincipal Sesion sesion, @RequestParam int colaId, @RequestParam(defaultValue = "false") boolean activo,
                         @RequestParam int duracionSlotMin, @RequestParam int cuotaCitasPct, @RequestParam(required = false) Integer capacidadFija,
                         @RequestParam int anticipacionMinMin, @RequestParam int anticipacionMaxDias, @RequestParam int checkinAntesMin,
                         @RequestParam int checkinDespuesMin, @RequestParam int graciaNoShowMin, @RequestParam int maxNoShow, @RequestParam int bloqueoDias,
                         @RequestParam int pesoCita, HttpServletRequest peticion, RedirectAttributes flash) {
        int localId = local(sesion, peticion);
        try {
            gestion.guardarConfig(localId, colaId, new ConfigCitas(activo, duracionSlotMin, cuotaCitasPct, capacidadFija, anticipacionMinMin,
                    anticipacionMaxDias, checkinAntesMin, checkinDespuesMin, graciaNoShowMin, maxNoShow, bloqueoDias, pesoCita, null),
                    Auditoria.Actor.de(sesion, peticion));
            flash.addFlashAttribute("mensaje", "Configuración guardada");
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        }
        return "redirect:" + RUTA + "?tab=config&colaId=" + colaId;
    }

    @PostMapping(RUTA + "/bloqueos")
    @SoloAdmin
    String crearBloqueo(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) Integer colaId, @RequestParam String inicio,
                        @RequestParam String fin, @RequestParam String motivo, HttpServletRequest peticion, RedirectAttributes flash) {
        int localId = local(sesion, peticion);
        try {
            gestion.crearBloqueo(localId, colaId, gestion.instanteLocal(localId, inicio), gestion.instanteLocal(localId, fin), motivo);
            flash.addFlashAttribute("mensaje", "Bloqueo creado; los horarios libres de ese rango se retiraron");
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        } catch (RuntimeException e) {
            flash.addFlashAttribute("error", "Fechas inválidas");
        }
        return "redirect:" + RUTA + "?tab=bloqueos";
    }

    @PostMapping(RUTA + "/bloqueos/{id}/eliminar")
    @SoloAdmin
    String eliminarBloqueo(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, RedirectAttributes flash) {
        gestion.eliminarBloqueo(local(sesion, peticion), id);
        flash.addFlashAttribute("mensaje", "Bloqueo eliminado");
        return "redirect:" + RUTA + "?tab=bloqueos";
    }

    @PostMapping(RUTA + "/bloqueos-cliente/{id}/liberar")
    @SoloAdmin
    String liberar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, RedirectAttributes flash) {
        gestion.liberarCliente(local(sesion, peticion), id, sesion.sub());
        flash.addFlashAttribute("mensaje", "Cliente liberado");
        return "redirect:" + RUTA + "?tab=bloqueos";
    }

    /** Widget del panel del operador: citas de los próximos 60 min y PIN de presencia (se refresca solo). */
    @GetMapping("/panel/citas")
    @SoloPersonal
    String widgetPanel(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        if (!modulos.activo(localId, Modulo.M3)) {
            return "fragmentos/base :: vacio";
        }
        modelo.addAttribute("proximas", gestion.proximas(localId, 60));
        modelo.addAttribute("pin", checkin.pinActual(localId));
        return "modulos/citas-panel :: widget";
    }

    private void agenda(int localId, String fecha, Integer colaId, Model modelo) {
        LocalDate f = fecha == null || fecha.isBlank() ? gestion.hoy(localId) : CitasApi.fechaValida(fecha);
        var agenda = gestion.agenda(localId, f, colaId);
        modelo.addAttribute("agenda", agenda);
        modelo.addAttribute("fecha", f.toString());
        modelo.addAttribute("colaId", colaId);
        modelo.addAttribute("libres", agenda.slots().stream().filter(s -> s.reservados() < s.capacidad()).toList());
        modelo.addAttribute("ocupacion", agenda.slots().isEmpty() ? 0
                : agenda.slots().stream().mapToInt(GestionCitas.SlotAgenda::reservados).sum() * 100
                        / Math.max(1, agenda.slots().stream().mapToInt(GestionCitas.SlotAgenda::capacidad).sum()));
        modelo.addAttribute("estados", List.of("RESERVADA", "CONFIRMADA", "CHECKIN", "ATENDIDA", "NO_SHOW", "CANCELADA"));
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modulos.exigir(localId, Modulo.M3);
        return localId;
    }
}
