package pe.turnoya.nucleo.web.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.aplicacion.EmisionTurnos;
import pe.turnoya.nucleo.aplicacion.HistorialTurnos;
import pe.turnoya.nucleo.aplicacion.OperacionVentanilla;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloPersonal;

/** Turnos desde la ventanilla: historial del día (N02), cambio de estado (RF06) y ticket impreso (RF07). */
@RestController
@RequestMapping("/api/v1/turnos")
@SoloPersonal
class TurnosPersonalApi {

    private final HistorialTurnos historial;
    private final OperacionVentanilla operacion;
    private final EmisionTurnos emision;
    private final LocalDeTrabajo localDeTrabajo;

    TurnosPersonalApi(HistorialTurnos historial, OperacionVentanilla operacion, EmisionTurnos emision, LocalDeTrabajo localDeTrabajo) {
        this.historial = historial;
        this.operacion = operacion;
        this.emision = emision;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping
    RespuestaApi<HistorialTurnos.Pagina> historial(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion,
                                                   @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fecha,
                                                   @RequestParam(required = false) Integer ventanillaId,
                                                   @RequestParam(required = false) EstadoTurno estado,
                                                   @RequestParam(required = false) Integer cursor) {
        return RespuestaApi.ok(historial.consultar(localDeTrabajo.resolver(sesion, peticion), fecha, ventanillaId, estado, cursor));
    }

    @PatchMapping("/{id}/estado")
    RespuestaApi<Map<String, Object>> cambiarEstado(@PathVariable int id, @Valid @RequestBody CambioEstado cambio,
                                                    @AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        if (cambio.estado() == EstadoTurno.EMITIDO || cambio.estado() == EstadoTurno.AVISADO || cambio.estado() == EstadoTurno.TRANSFERIDO) {
            throw new ErrorNegocio("VALIDACION", "estado: debe ser LLAMADO, ATENDIDO, NO_SE_PRESENTO o CANCELADO", 422);
        }
        Turno t = operacion.cambiarEstado(id, localDeTrabajo.resolver(sesion, peticion), cambio.estado(), Auditoria.Actor.de(sesion, peticion));
        return RespuestaApi.ok(Map.of("id", t.id(), "estado", t.estado(), "rellamadas", t.rellamadas()));
    }

    @PostMapping("/ticket")
    ResponseEntity<RespuestaApi<TurnoPublico>> ticket(@Valid @RequestBody PedidoTicket pedido, @AuthenticationPrincipal Sesion sesion,
                                                      HttpServletRequest peticion) {
        Integer localDelOperador = sesion.esSuperAdmin() ? null : localDeTrabajo.resolver(sesion, peticion);
        return RespuestaApi.creado(emision.emitirTicket(localDelOperador, pedido.colaId(), pedido.nombre(), pedido.categoriaCodigo()));
    }

    record CambioEstado(@NotNull EstadoTurno estado) {
    }

    record PedidoTicket(@NotNull @Positive Integer colaId, @Size(max = 60) String nombre, @Size(max = 16) String categoriaCodigo) {
    }
}
