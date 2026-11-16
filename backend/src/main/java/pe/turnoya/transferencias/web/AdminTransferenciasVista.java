package pe.turnoya.transferencias.web;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.transferencias.Transferencias;

/** {@code /admin/modulos/transferencias}: historial de clientes pasados de una cola a otra (quién, cuándo y por qué). */
@Controller
@SoloAdmin
class AdminTransferenciasVista {

    private final Transferencias transferencias;
    private final LocalDeTrabajo localDeTrabajo;

    AdminTransferenciasVista(Transferencias transferencias, LocalDeTrabajo localDeTrabajo) {
        this.transferencias = transferencias;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/admin/modulos/transferencias")
    String pagina(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modelo.addAttribute("seccion", "M6");
        modelo.addAttribute("transferencias", transferencias.historial(localId, null, null, null).items());
        modelo.addAttribute("nombresMotivo", Transferencias.NOMBRES_MOTIVO);
        return "modulos/transferencias";
    }
}
