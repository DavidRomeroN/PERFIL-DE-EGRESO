package pe.turnoya.balanceo.reglas;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tareas.TareaProgramada;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** {@code /api/v1/balanceo/**} (M6, ADMIN): carga en vivo, reglas, ejecuciones y confirmaciones, y "Balancear ahora". */
@RestController
@SoloAdmin
@RequestMapping("/api/v1/balanceo")
class BalanceoApi {

    private final GestionReglas reglas;
    private final EvaluadorBalanceo evaluador;
    private final MetricasBalanceo metricas;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;

    BalanceoApi(GestionReglas reglas, EvaluadorBalanceo evaluador, MetricasBalanceo metricas, LocalDeTrabajo localDeTrabajo, ModulosLocal modulos) {
        this.reglas = reglas;
        this.evaluador = evaluador;
        this.metricas = metricas;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
    }

    @PostMapping
    RespuestaApi<EvaluadorBalanceo.Balanceo> balancear(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(evaluador.balancearAhora(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion)));
    }

    @GetMapping("/carga")
    RespuestaApi<MetricasBalanceo.Carga> carga(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        int localId = local(sesion, peticion);
        modulos.exigir(localId, Modulo.M6);
        return RespuestaApi.ok(metricas.carga(localId));
    }

    @GetMapping("/reglas")
    RespuestaApi<List<GestionReglas.VistaRegla>> listar(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(reglas.listar(local(sesion, peticion)));
    }

    /** Toda regla nace en SIMULACION (RN-M6-09). */
    @PostMapping("/reglas")
    ResponseEntity<RespuestaApi<GestionReglas.VistaRegla>> crear(@AuthenticationPrincipal Sesion sesion, @RequestBody Cuerpo b, HttpServletRequest peticion) {
        return RespuestaApi.creado(reglas.crear(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion), entrada(b)));
    }

    /** Sin guardar: condición, recursos y contradicciones. */
    @PostMapping("/reglas/validar")
    RespuestaApi<GestionReglas.Validacion> validar(@AuthenticationPrincipal Sesion sesion, @RequestBody Cuerpo b, HttpServletRequest peticion) {
        return RespuestaApi.ok(reglas.validar(local(sesion, peticion), entrada(b), b.id()));
    }

    @PatchMapping("/reglas/{id}")
    RespuestaApi<GestionReglas.VistaRegla> editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestBody Cuerpo b,
                                                 HttpServletRequest peticion) {
        if (b == null) {
            throw new ErrorNegocio("VALIDACION", "Sin cambios", 422);
        }
        return RespuestaApi.ok(reglas.editar(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion), id, parcial(b), b.activa(), b.modo()));
    }

    @DeleteMapping("/reglas/{id}")
    RespuestaApi<Map<String, Boolean>> eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion) {
        evaluador.eliminar(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion), id);
        return RespuestaApi.ok(Map.of("eliminada", true));
    }

    @PostMapping("/reglas/{id}/probar")
    RespuestaApi<GestionReglas.Prueba> probar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion) {
        return RespuestaApi.ok(reglas.probar(local(sesion, peticion), id));
    }

    @GetMapping("/ejecuciones")
    RespuestaApi<EvaluadorBalanceo.Ejecuciones> ejecuciones(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) Integer regla,
                                                           @RequestParam(required = false) String resultado, @RequestParam(required = false) Long cursor,
                                                           HttpServletRequest peticion) {
        return RespuestaApi.ok(evaluador.ejecuciones(local(sesion, peticion), regla, resultado, cursor));
    }

    @PostMapping("/ejecuciones/{id}/confirmar")
    RespuestaApi<EvaluadorBalanceo.Confirmacion> confirmar(@AuthenticationPrincipal Sesion sesion, @PathVariable long id, @RequestBody Aprobacion b,
                                                          HttpServletRequest peticion) {
        if (b == null || b.aprobar() == null) {
            throw new ErrorNegocio("VALIDACION", "Indica si apruebas la acción", 422);
        }
        return RespuestaApi.ok(evaluador.resolverConfirmacion(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion), id, b.aprobar()));
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        return localDeTrabajo.resolver(sesion, peticion);
    }

    private static GestionReglas.Entrada entrada(Cuerpo b) {
        if (b == null) {
            throw new ErrorNegocio("VALIDACION", "Faltan los datos de la regla", 422);
        }
        return parcial(b);
    }

    private static GestionReglas.Entrada parcial(Cuerpo b) {
        return new GestionReglas.Entrada(b.nombre(), b.condicion(), b.accion(), b.forSegundos(), b.forSegundosReversa(), b.cooldownSeg(), b.histeresisPct(),
                b.ttlSeg(), b.requiereConfirmacion(), b.prioridad());
    }

    record Cuerpo(Integer id, String nombre, Object condicion, Object accion, Integer forSegundos, Integer forSegundosReversa, Integer cooldownSeg,
                  Integer histeresisPct, Integer ttlSeg, Boolean requiereConfirmacion, Integer prioridad, Boolean activa, String modo) {
    }

    record Aprobacion(Boolean aprobar) {
    }

    /** Jobs de M6 (mismos nombres que el sistema anterior). */
    @Configuration(proxyBeanMethods = false)
    static class Tareas {

        @Bean
        TareaProgramada balanceoEvaluar(EvaluadorBalanceo e) {
            return TareaProgramada.cada("balanceo-evaluar", Duration.ofSeconds(30), "M6: evalúa reglas de balanceo por local (candado consultivo)", e::job);
        }

        @Bean
        TareaProgramada balanceoLimpiar(EvaluadorBalanceo e) {
            return TareaProgramada.diaria("balanceo-limpiar", LocalTime.of(4, 30), "M6: elimina ejecuciones de más de 90 días", e::limpiar);
        }
    }
}
