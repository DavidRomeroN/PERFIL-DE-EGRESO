package pe.turnoya.analitica.alertas;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Arrays;
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
import pe.turnoya.analitica.dominio.ReglasAnalitica;
import pe.turnoya.analitica.tablero.ConsultasAnalitica;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tareas.TareaProgramada;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** {@code /api/v1/alertas/**} (M7, ADMIN): alertas y su ciclo de vida, reglas y el contador de la campana. */
@RestController
@SoloAdmin
@RequestMapping("/api/v1/alertas")
class AlertasApi {

    private final MotorAlertas motor;
    private final ReglasDeAlerta reglas;
    private final LocalDeTrabajo localDeTrabajo;

    AlertasApi(MotorAlertas motor, ReglasDeAlerta reglas, LocalDeTrabajo localDeTrabajo) {
        this.motor = motor;
        this.reglas = reglas;
        this.localDeTrabajo = localDeTrabajo;
    }

    /** {@code ?estado=ABIERTA,RECONOCIDA&tipo&cursor} */
    @GetMapping
    RespuestaApi<MotorAlertas.Pagina> listar(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String estado,
                                            @RequestParam(required = false) String tipo, @RequestParam(required = false) Long cursor, HttpServletRequest peticion) {
        List<String> estados = estado == null || estado.isBlank() ? List.of() : Arrays.stream(estado.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
        return RespuestaApi.ok(motor.listar(local(sesion, peticion), estados, tipo, cursor));
    }

    /** Ciclo de vida (RF-M7-07): RECONOCER, RESOLVER, SILENCIAR (con {@code hasta}) o REABRIR. */
    @PatchMapping("/{id}")
    RespuestaApi<MotorAlertas.VistaAlerta> accion(@AuthenticationPrincipal Sesion sesion, @PathVariable long id, @RequestBody Accion b, HttpServletRequest peticion) {
        if (b == null) {
            throw new ErrorNegocio("VALIDACION", "Indica la acción", 422);
        }
        Instant hasta;
        try {
            hasta = b.hasta() == null || b.hasta().isBlank() ? null : Instant.parse(b.hasta());
        } catch (RuntimeException e) {
            throw new ErrorNegocio("VALIDACION", "Fecha inválida", 422);
        }
        return RespuestaApi.ok(motor.vista(motor.accion(local(sesion, peticion), id, b.accion(), sesion.sub(), hasta)));
    }

    /** Contador para la campana: no exige M7 (devuelve 0 si está apagado). */
    @GetMapping("/resumen")
    RespuestaApi<MotorAlertas.Resumen> resumen(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(motor.resumen(local(sesion, peticion)));
    }

    @GetMapping("/reglas")
    RespuestaApi<List<ReglasDeAlerta.VistaRegla>> reglas(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(reglas.listar(local(sesion, peticion)));
    }

    @PostMapping("/reglas")
    ResponseEntity<RespuestaApi<ReglasDeAlerta.VistaRegla>> crear(@AuthenticationPrincipal Sesion sesion, @RequestBody Regla b, HttpServletRequest peticion) {
        if (b == null) {
            throw new ErrorNegocio("VALIDACION", "Faltan los datos de la regla", 422);
        }
        return RespuestaApi.creado(reglas.crear(local(sesion, peticion), datos(b)));
    }

    @PatchMapping("/reglas/{id}")
    RespuestaApi<ReglasDeAlerta.VistaRegla> editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestBody Regla b, HttpServletRequest peticion) {
        if (b == null) {
            throw new ErrorNegocio("VALIDACION", "Sin cambios", 422);
        }
        return RespuestaApi.ok(reglas.editar(local(sesion, peticion), id, datos(b)));
    }

    @DeleteMapping("/reglas/{id}")
    RespuestaApi<Map<String, Boolean>> eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion) {
        reglas.eliminar(local(sesion, peticion), id);
        return RespuestaApi.ok(Map.of("eliminada", true));
    }

    private static ReglasDeAlerta.Datos datos(Regla b) {
        Instant silencio;
        try {
            silencio = b.silenciadaHasta() == null || b.silenciadaHasta().isBlank() ? null : Instant.parse(b.silenciadaHasta());
        } catch (RuntimeException e) {
            throw new ErrorNegocio("VALIDACION", "Fecha inválida", 422);
        }
        boolean quitar = b.silenciadaHasta() != null && b.silenciadaHasta().isBlank();
        return new ReglasDeAlerta.Datos(b.tipo(), b.nombre(), b.umbral(), b.niveles(), b.resolverTrasMin(), b.activa(), silencio, quitar);
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        return localDeTrabajo.resolver(sesion, peticion);
    }

    record Accion(String accion, String hasta) {
    }

    record Regla(String tipo, String nombre, Map<String, Object> umbral, List<ReglasAnalitica.Nivel> niveles, Integer resolverTrasMin, Boolean activa,
                 String silenciadaHasta) {
    }

    /** Jobs de M7 (mismos nombres que el sistema anterior). Los reportes programados por correo no están en esta versión. */
    @Configuration(proxyBeanMethods = false)
    static class Tareas {

        @Bean
        TareaProgramada alertasEvaluar(MotorAlertas m) {
            return TareaProgramada.cada("alertas-evaluar", Duration.ofSeconds(60), "M7: SLA, espera, anomalías, escalamiento", m::job);
        }

        @Bean
        TareaProgramada analiticaRefrescarMv(ConsultasAnalitica c) {
            return TareaProgramada.cada("analitica-refrescar-mv", Duration.ofSeconds(300), "M7: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_turno_franja",
                    c::refrescarVista);
        }

        @Bean
        TareaProgramada analiticaLimpiar(MotorAlertas m) {
            return TareaProgramada.diaria("analitica-limpiar", LocalTime.of(4, 45), "M7: alertas resueltas de más de 180 días", m::limpiar);
        }
    }
}
