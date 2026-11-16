package pe.turnoya.nucleo.reportes;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/**
 * Dashboard del administrador ({@code /admin}): indicadores de hoy, colas en vivo, últimos llamados y la semana
 * (resultado de los turnos, turnos por día, demanda por hora y canales). Se refresca con cada evento del local.
 */
@Controller
@SoloAdmin
class TableroVista {

    private final ConsultaTurnos consulta;
    private final ReportesTurnos reportes;
    private final LocalDeTrabajo localDeTrabajo;

    TableroVista(ConsultaTurnos consulta, ReportesTurnos reportes, LocalDeTrabajo localDeTrabajo) {
        this.consulta = consulta;
        this.reportes = reportes;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/admin")
    String tablero(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        cargar(sesion, peticion, modelo);
        return "admin/tablero";
    }

    @GetMapping("/admin/tablero/contenido")
    String contenido(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        cargar(sesion, peticion, modelo);
        return "admin/tablero :: contenido";
    }

    private void cargar(Sesion sesion, HttpServletRequest peticion, Model modelo) {
        Local local = localDeTrabajo.local(sesion, peticion);
        modelo.addAttribute("seccion", "dashboard");
        modelo.addAttribute("snap", consulta.snapshot(local, true));
        modelo.addAttribute("semana", reportes.generar(local.id(), reportes.haceDias(local.id(), 6), reportes.haceDias(local.id(), 0)));
    }
}
