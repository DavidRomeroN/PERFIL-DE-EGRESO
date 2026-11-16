package pe.turnoya.plataforma.operacion;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.dominio.RepositorioHorarios.HorarioDia;

/** {@code /api/v1/operacion}: mismo contrato que el sistema anterior ({@code accion}: horario o ausencia). */
@RestController
@SoloAdmin
@RequestMapping("/api/v1/operacion")
class OperacionApi {

    private final GestionOperacion operacion;
    private final LocalDeTrabajo localDeTrabajo;

    OperacionApi(GestionOperacion operacion, LocalDeTrabajo localDeTrabajo) {
        this.operacion = operacion;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping
    RespuestaApi<GestionOperacion.Operacion> consultar(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(operacion.consultar(localDeTrabajo.resolver(sesion, peticion)));
    }

    @PostMapping
    RespuestaApi<Map<String, Boolean>> guardar(@AuthenticationPrincipal Sesion sesion, @RequestBody Cuerpo b, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        Auditoria.Actor actor = Auditoria.Actor.de(sesion, peticion);
        switch (b.accion() == null ? "" : b.accion()) {
            case "horario" -> {
                if (b.diaSemana() == null) {
                    throw new ErrorNegocio("VALIDACION", "Falta el día de la semana", 422);
                }
                operacion.guardarHorario(localId, List.of(new HorarioDia(b.diaSemana(), b.apertura(), b.cierre(), Boolean.TRUE.equals(b.activo()))), actor);
            }
            case "ausencia" -> operacion.guardarAusencia(localId, b.ausenciaSeg(), actor);
            default -> throw new ErrorNegocio("VALIDACION", "Acción desconocida", 422);
        }
        return RespuestaApi.ok(Map.of("listo", true));
    }

    record Cuerpo(String accion, Integer diaSemana, String apertura, String cierre, Boolean activo, Integer ausenciaSeg) {
    }
}
