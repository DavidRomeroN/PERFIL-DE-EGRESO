package pe.turnoya.prediccion.entrenamiento;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion.Config;

/** {@code /api/v1/prediccion/{config,metricas,reentrenar}} (M2), mismo contrato que el sistema anterior. */
@RestController
@SoloAdmin
@RequestMapping("/api/v1/prediccion")
class PrediccionApi {

    private final ConfiguracionPrediccion configuracion;
    private final EntrenamientoModelos entrenamiento;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;

    PrediccionApi(ConfiguracionPrediccion configuracion, EntrenamientoModelos entrenamiento, LocalDeTrabajo localDeTrabajo, ModulosLocal modulos) {
        this.configuracion = configuracion;
        this.entrenamiento = entrenamiento;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
    }

    @GetMapping("/config")
    RespuestaApi<Config> config(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(configuracion.leer(local(sesion, peticion)));
    }

    @PutMapping("/config")
    RespuestaApi<Config> guardar(@AuthenticationPrincipal Sesion sesion, @RequestBody ConfigJson b, HttpServletRequest peticion) {
        if (b.modelo() == null || b.alfaEma() == null || b.nivelConfianza() == null || b.diasEntrenamiento() == null) {
            throw new ErrorNegocio("VALIDACION", "Faltan campos: modelo, alfaEma, nivelConfianza, diasEntrenamiento", 422);
        }
        return RespuestaApi.ok(configuracion.guardar(local(sesion, peticion),
                new Config(b.modelo(), b.alfaEma(), b.nivelConfianza(), b.diasEntrenamiento()), Auditoria.Actor.de(sesion, peticion)));
    }

    @GetMapping("/metricas")
    RespuestaApi<EntrenamientoModelos.Metricas> metricas(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) Integer colaId,
                                               @RequestParam(required = false) Integer dias, HttpServletRequest peticion) {
        int localId = local(sesion, peticion);
        if (colaId == null || colaId <= 0) {
            throw new ErrorNegocio("VALIDACION", "Indica la cola", 422);
        }
        return RespuestaApi.ok(entrenamiento.metricas(localId, colaId, Math.min(60, dias == null ? 14 : Math.max(1, dias))));
    }

    @PostMapping("/reentrenar")
    RespuestaApi<List<EntrenamientoModelos.Resultado>> reentrenar(@AuthenticationPrincipal Sesion sesion,
                                                                 @RequestBody(required = false) Reentrenar b, HttpServletRequest peticion) {
        return RespuestaApi.ok(entrenamiento.reentrenarLocal(local(sesion, peticion), b == null ? null : b.colaId()));
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modulos.exigir(localId, Modulo.M2);
        return localId;
    }

    record ConfigJson(String modelo, Double alfaEma, Double nivelConfianza, Integer diasEntrenamiento) {
    }

    record Reentrenar(Integer colaId) {
    }
}
