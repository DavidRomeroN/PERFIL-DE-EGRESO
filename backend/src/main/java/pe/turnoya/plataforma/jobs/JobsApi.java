package pe.turnoya.plataforma.jobs;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.tareas.PlanificadorTareas.EstadoTarea;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloSuperAdmin;

/** {@code /api/v1/jobs} (F1, solo super admin). */
@RestController
@SoloSuperAdmin
@RequestMapping("/api/v1/jobs")
class JobsApi {

    private final TareasPlataforma tareas;

    JobsApi(TareasPlataforma tareas) {
        this.tareas = tareas;
    }

    @GetMapping
    RespuestaApi<List<EstadoTarea>> estado() {
        return RespuestaApi.ok(tareas.estado());
    }

    @PostMapping("/{nombre}")
    RespuestaApi<Object> ejecutar(@AuthenticationPrincipal Sesion sesion, @PathVariable String nombre, HttpServletRequest peticion) {
        return RespuestaApi.ok(tareas.ejecutar(nombre, Auditoria.Actor.de(sesion, peticion)));
    }
}
