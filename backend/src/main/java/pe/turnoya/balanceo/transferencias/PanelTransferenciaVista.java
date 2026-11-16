package pe.turnoya.balanceo.transferencias;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Clock;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloPersonal;

/** Bloque "Transferir a otra cola" del panel del operador (M6). Responde vacío si el módulo no está activo. */
@Controller
@SoloPersonal
class PanelTransferenciaVista {

    private final Transferencias transferencias;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;
    private final CatalogoLocales locales;
    private final Clock reloj;

    PanelTransferenciaVista(Transferencias transferencias, LocalDeTrabajo localDeTrabajo, ModulosLocal modulos, CatalogoLocales locales, Clock reloj) {
        this.transferencias = transferencias;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
        this.locales = locales;
        this.reloj = reloj;
    }

    @GetMapping("/panel/transferencia")
    String bloque(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) Integer ventanilla, HttpServletRequest peticion, Model modelo) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        if (!modulos.activo(localId, Modulo.M6)) {
            return "fragmentos/base :: vacio";
        }
        return bloque(localId, ventanilla, modelo);
    }

    @PostMapping("/panel/transferencia")
    String transferir(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) Integer ventanilla, @RequestParam(required = false) Integer turnoId,
                      @RequestParam(required = false) Integer aColaId, @RequestParam(defaultValue = "ERROR_DE_COLA") String motivo,
                      @RequestParam(required = false) String detalle, HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        try {
            if (turnoId == null || aColaId == null) {
                throw new ErrorNegocio("VALIDACION", "Elige el turno y la cola destino", 422);
            }
            var t = transferencias.transferir(Auditoria.Actor.de(sesion, peticion), localId, turnoId,
                    Transferencias.Solicitud.manual(aColaId, null, motivo, detalle, true));
            Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Turno transferido: ahora es " + t.codigo() + " y conserva su lugar");
        } catch (ErrorNegocio e) {
            Htmx.aviso(respuesta, Htmx.Tipo.ERROR, e.getMessage());
        }
        return bloque(localId, ventanilla, modelo);
    }

    private String bloque(int localId, Integer ventanilla, Model modelo) {
        var fecha = Fechas.fechaLocal(locales.exigir(localId).zonaHoraria(), reloj.instant());
        modelo.addAttribute("bloque", transferencias.bloquePanel(localId, fecha, ventanilla));
        modelo.addAttribute("ventanilla", ventanilla);
        modelo.addAttribute("motivos", Transferencias.MOTIVOS.stream().filter(m -> !"BALANCEO".equals(m)).toList());
        modelo.addAttribute("nombresMotivo", Transferencias.NOMBRES_MOTIVO);
        return "modulos/transferencia-panel :: bloque";
    }
}
