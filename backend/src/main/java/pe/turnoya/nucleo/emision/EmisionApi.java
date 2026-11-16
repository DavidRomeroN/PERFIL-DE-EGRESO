package pe.turnoya.nucleo.emision;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.atencion.AccesoVentanillas;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloPersonal;

/**
 * API de emisión: datos del local para tomar turno, tomar turno por QR o desde la app móvil (RF01) y ticket impreso desde la
 * ventanilla (RF07).
 */
@RestController
class EmisionApi {

    private final InformacionLocal informacion;
    private final EmisionTurnos emision;
    private final LimitadorPeticiones limitador;
    private final LocalDeTrabajo localDeTrabajo;
    private final AccesoVentanillas acceso;

    EmisionApi(InformacionLocal informacion, EmisionTurnos emision, LimitadorPeticiones limitador, LocalDeTrabajo localDeTrabajo,
               AccesoVentanillas acceso) {
        this.informacion = informacion;
        this.emision = emision;
        this.limitador = limitador;
        this.localDeTrabajo = localDeTrabajo;
        this.acceso = acceso;
    }

    @GetMapping("/api/v1/public/locales/{slug}")
    RespuestaApi<InformacionLocal.LocalParaCliente> local(@PathVariable String slug) {
        return RespuestaApi.ok(informacion.porSlug(slug));
    }

    /** Límite: 5 por minuto e IP. */
    @PostMapping("/api/v1/public/turnos")
    ResponseEntity<RespuestaApi<TurnoPublico>> tomar(@Valid @RequestBody PedidoTurno pedido, HttpServletRequest peticion) {
        if (!limitador.permitir("turnos", IpCliente.de(peticion), 5)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiadas solicitudes. Intenta en un minuto.", 429);
        }
        // La app móvil toma sus turnos en /api/v1/public/app/turnos, que exige presencia y dispositivo
        if ("APP".equalsIgnoreCase(pedido.canal())) {
            throw new ErrorNegocio("APP_ACTUALIZAR", "Actualiza la app TurnoYa para tomar tu turno.", 426);
        }
        boolean consentimiento = Boolean.TRUE.equals(pedido.consentimiento());
        TurnoPublico turno = emision.emitir(
                SolicitudEmision.porQr(pedido.colaId(), pedido.nombre(), pedido.telefono(), consentimiento, pedido.categoriaCodigo()));
        return RespuestaApi.creado(turno);
    }

    @PostMapping("/api/v1/turnos/ticket")
    @SoloPersonal
    ResponseEntity<RespuestaApi<TurnoPublico>> ticket(@Valid @RequestBody PedidoTicket pedido, @AuthenticationPrincipal Sesion sesion,
                                                      HttpServletRequest peticion) {
        Integer localDelOperador = sesion.esSuperAdmin() ? null : localDeTrabajo.resolver(sesion, peticion);
        if (localDelOperador != null) {
            acceso.exigirCola(sesion, localDelOperador, pedido.colaId());
        }
        return RespuestaApi.creado(emision.emitirTicket(localDelOperador, pedido.colaId(), pedido.nombre(), pedido.categoriaCodigo(),
                pedido.telefono(), Boolean.TRUE.equals(pedido.consentimiento())));
    }

    record PedidoTurno(
            @NotNull @Positive Integer colaId,
            @Size(max = 60) String nombre,
            @Size(max = 20) String telefono,
            Boolean consentimiento,
            @Size(max = 40) String categoriaCodigo,
            // Opcional: QR (por defecto, la web) o APP (la app móvil). WhatsApp entra por el bot, no por aquí.
            @Pattern(regexp = "(?i)QR|APP") String canal) {
    }

    record PedidoTicket(@NotNull @Positive Integer colaId, @Size(max = 60) String nombre, @Size(max = 16) String categoriaCodigo,
                        @Size(max = 20) String telefono, Boolean consentimiento) {
    }
}
