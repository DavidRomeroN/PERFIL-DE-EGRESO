package pe.turnoya.analitica.tablero;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
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

/** {@code /api/v1/analitica/**} y {@code /api/v1/sla/{colaId}} (M7, ADMIN). */
@RestController
@SoloAdmin
class AnaliticaApi {

    private final ConsultasAnalitica consultas;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;

    AnaliticaApi(ConsultasAnalitica consultas, LocalDeTrabajo localDeTrabajo, ModulosLocal modulos) {
        this.consultas = consultas;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
    }

    /** KPIs, percentiles por cola, SLA y CSAT del rango (por defecto las últimas 8 semanas). */
    @GetMapping("/api/v1/analitica/resumen")
    RespuestaApi<ConsultasAnalitica.Resumen> resumen(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String desde,
                                                    @RequestParam(required = false) String hasta, @RequestParam(required = false) Integer colaId,
                                                    HttpServletRequest peticion) {
        int localId = local(sesion, peticion);
        return RespuestaApi.ok(consultas.resumen(localId, consultas.rango(localId, desde, hasta), colaId));
    }

    @GetMapping("/api/v1/analitica/percentiles")
    RespuestaApi<List<ConsultasAnalitica.Percentil>> percentiles(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String desde,
                                                                @RequestParam(required = false) String hasta, @RequestParam(required = false) Integer colaId,
                                                                @RequestParam(defaultValue = "cola") String agrupar, HttpServletRequest peticion) {
        int localId = local(sesion, peticion);
        return RespuestaApi.ok(consultas.percentiles(localId, consultas.rango(localId, desde, hasta), colaId, agrupar));
    }

    @GetMapping("/api/v1/analitica/heatmap")
    RespuestaApi<ConsultasAnalitica.MapaCalor> heatmap(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String desde,
                                                      @RequestParam(required = false) String hasta, @RequestParam(required = false) Integer colaId,
                                                      @RequestParam(defaultValue = "llegadas") String metrica, HttpServletRequest peticion) {
        int localId = local(sesion, peticion);
        return RespuestaApi.ok(consultas.mapaDeCalor(localId, consultas.rango(localId, desde, hasta), colaId, metrica));
    }

    @GetMapping("/api/v1/analitica/csat")
    RespuestaApi<ConsultasAnalitica.Csat> csat(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String desde,
                                              @RequestParam(required = false) String hasta, HttpServletRequest peticion) {
        int localId = local(sesion, peticion);
        return RespuestaApi.ok(consultas.csat(localId, consultas.rango(localId, desde, hasta)));
    }

    /** Cumplimiento actual con censura a la derecha y presupuesto de error. */
    @GetMapping("/api/v1/analitica/sla")
    RespuestaApi<List<ConsultasAnalitica.EstadoSla>> sla(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        int localId = local(sesion, peticion);
        modulos.exigir(localId, Modulo.M7);
        return RespuestaApi.ok(consultas.estadoSla(localId));
    }

    @GetMapping("/api/v1/analitica/sla/serie")
    RespuestaApi<List<ConsultasAnalitica.PuntoSla>> serie(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) Integer colaId,
                                                        @RequestParam(defaultValue = "7") int dias, HttpServletRequest peticion) {
        if (colaId == null) {
            throw new ErrorNegocio("VALIDACION", "Indica la cola", 422);
        }
        return RespuestaApi.ok(consultas.serieSla(local(sesion, peticion), colaId, dias));
    }

    @GetMapping("/api/v1/sla/{colaId}")
    RespuestaApi<ConsultasAnalitica.EstadoSla> verSla(@AuthenticationPrincipal Sesion sesion, @PathVariable int colaId, HttpServletRequest peticion) {
        int localId = local(sesion, peticion);
        modulos.exigir(localId, Modulo.M7);
        return RespuestaApi.ok(consultas.estadoSla(localId).stream().filter(s -> s.colaId() == colaId).findFirst()
                .orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe")));
    }

    /** Auditado por trigger (RN-M7-09). */
    @PutMapping("/api/v1/sla/{colaId}")
    RespuestaApi<ConsultasAnalitica.SlaGuardado> guardarSla(@AuthenticationPrincipal Sesion sesion, @PathVariable int colaId, @RequestBody Sla b,
                                                           HttpServletRequest peticion) {
        if (b == null) {
            throw new ErrorNegocio("VALIDACION", "Faltan los datos del SLA", 422);
        }
        return RespuestaApi.ok(consultas.guardarSla(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion), colaId, b.esperaMaxMin(), b.objetivoPct(),
                b.ventanaMin(), b.activo()));
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        return localDeTrabajo.resolver(sesion, peticion);
    }

    record Sla(Integer esperaMaxMin, Double objetivoPct, Integer ventanaMin, Boolean activo) {
    }
}
