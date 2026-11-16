package pe.turnoya.kiosco.recepcion;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.SnapshotLocal;
import pe.turnoya.nucleo.TomaDeTurnos;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.puertos.PoliticaPrioridad;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloKiosco;
import pe.turnoya.transferencias.Transferencias;

/**
 * Panel del usuario de kiosco (recepción): ve todas las colas del local, emite tickets impresos para cualquiera de ellas
 * y pasa clientes de una cola a otra sin que pierdan su lugar. No llama turnos: eso es de los operadores.
 *
 * <p>Cada acción devuelve el contenido actualizado (htmx lo reemplaza); el resto de cambios llega por SSE.
 */
@Controller
@SoloKiosco
class PanelKioscoVista {

    private final ConsultaTurnos consulta;
    private final TomaDeTurnos toma;
    private final Transferencias transferencias;
    private final CatalogoLocales locales;
    private final LocalDeTrabajo localDeTrabajo;

    PanelKioscoVista(ConsultaTurnos consulta, TomaDeTurnos toma, Transferencias transferencias, CatalogoLocales locales,
                     LocalDeTrabajo localDeTrabajo) {
        this.consulta = consulta;
        this.toma = toma;
        this.transferencias = transferencias;
        this.locales = locales;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/panel-kiosco")
    String panel(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        cargar(local(sesion, peticion), modelo, true);
        return "kiosco/panel";
    }

    @GetMapping("/panel-kiosco/contenido")
    String contenido(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        cargar(local(sesion, peticion), modelo, false);
        return "kiosco/panel :: contenido";
    }

    /** Ticket impreso para cualquier cola del local; el navegador abre la ventana de impresión. */
    @PostMapping("/panel-kiosco/ticket")
    String ticket(@AuthenticationPrincipal Sesion sesion, @RequestParam int colaId, @RequestParam(required = false) String nombre,
                  @RequestParam(required = false) String categoria, @RequestParam(required = false) String telefono,
                  @RequestParam(defaultValue = "false") boolean consentimiento, HttpServletRequest peticion, HttpServletResponse respuesta,
                  Model modelo) {
        Local local = local(sesion, peticion);
        String n = nombre == null || nombre.isBlank() ? null : nombre.trim();
        if (n != null && n.length() > 60) {
            throw new ErrorNegocio("VALIDACION", "El nombre tiene hasta 60 caracteres", 422);
        }
        TurnoPublico t = toma.ticketDeRecepcion(local.id(), colaId, n, categoria == null || categoria.isBlank() ? null : categoria, telefono,
                consentimiento);
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Ticket " + t.codigo() + " emitido", Map.of("abrirVentana", "/ticket/" + t.token()));
        return fragmentoOPanel(local, peticion, modelo);
    }

    /** Pasa a un cliente que espera a otra cola: conserva su hora de llegada y su prioridad. */
    @PostMapping("/panel-kiosco/transferir")
    String transferir(@AuthenticationPrincipal Sesion sesion, @RequestParam int turnoId, @RequestParam int aColaId,
                      @RequestParam(defaultValue = "ERROR_DE_COLA") String motivo, HttpServletRequest peticion, HttpServletResponse respuesta,
                      Model modelo) {
        Local local = local(sesion, peticion);
        TurnoPublico t = transferencias.transferir(Auditoria.Actor.de(sesion, peticion), local.id(), turnoId,
                Transferencias.Solicitud.manual(aColaId, null, motivo, null, true));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Cliente transferido: ahora es " + t.codigo() + " y conserva su lugar");
        return fragmentoOPanel(local, peticion, modelo);
    }

    private String fragmentoOPanel(Local local, HttpServletRequest peticion, Model modelo) {
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:/panel-kiosco";
        }
        cargar(local, modelo, false);
        return "kiosco/panel :: contenido";
    }

    private Local local(Sesion sesion, HttpServletRequest peticion) {
        return locales.exigir(localDeTrabajo.resolver(sesion, peticion));
    }

    private void cargar(Local local, Model modelo, boolean paginaCompleta) {
        SnapshotLocal snap = consulta.snapshot(local, true);
        List<FilaEspera> espera = snap.colas().stream()
                .flatMap(c -> c.espera().stream().map(t -> new FilaEspera(t, c.id(), c.nombre(), c.prefijo())))
                .sorted((a, b) -> a.turno().emitidoAt().compareTo(b.turno().emitidoAt()))
                .toList();
        modelo.addAttribute("snap", snap);
        modelo.addAttribute("espera", espera);
        modelo.addAttribute("puedeTransferir", transferencias.disponible(local.id()) && snap.colas().size() > 1);
        if (paginaCompleta) {
            List<PoliticaPrioridad.CategoriaCliente> categorias = toma.local(local.slug()).categorias();
            modelo.addAttribute("categorias", categorias == null ? List.of() : categorias);
            modelo.addAttribute("motivos", Transferencias.MOTIVOS);
            modelo.addAttribute("nombresMotivo", Transferencias.NOMBRES_MOTIVO);
        }
    }

    /** Un cliente en espera, con su cola (para transferirlo a otra). */
    public record FilaEspera(SnapshotLocal.EnEspera turno, int colaId, String cola, String prefijo) {
    }
}
