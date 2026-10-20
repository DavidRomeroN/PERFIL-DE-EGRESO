package pe.turnoya.nucleo.web.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.aplicacion.CancelacionTurnos;
import pe.turnoya.nucleo.aplicacion.EmisionTurnos;
import pe.turnoya.nucleo.aplicacion.SolicitudEmision;
import pe.turnoya.nucleo.aplicacion.Valoraciones;

/** API pública del cliente: tomar turno por QR (RF01), consultarlo (RF02), cancelarlo (RF04) y valorarlo (N07). */
@RestController
@RequestMapping("/api/v1/public/turnos")
class TurnosPublicosApi {

    private final EmisionTurnos emision;
    private final ConsultaTurnos consulta;
    private final CancelacionTurnos cancelacion;
    private final Valoraciones valoraciones;
    private final LimitadorPeticiones limitador;

    TurnosPublicosApi(EmisionTurnos emision, ConsultaTurnos consulta, CancelacionTurnos cancelacion, Valoraciones valoraciones,
                      LimitadorPeticiones limitador) {
        this.emision = emision;
        this.consulta = consulta;
        this.cancelacion = cancelacion;
        this.valoraciones = valoraciones;
        this.limitador = limitador;
    }

    /** Límite: 5 por minuto e IP. */
    @PostMapping
    ResponseEntity<RespuestaApi<TurnoPublico>> tomar(@Valid @RequestBody PedidoTurno pedido, HttpServletRequest peticion) {
        if (!limitador.permitir("turnos", IpCliente.de(peticion), 5)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiadas solicitudes. Intenta en un minuto.", 429);
        }
        TurnoPublico turno = emision.emitir(SolicitudEmision.porQr(pedido.colaId(), pedido.nombre(), pedido.telefono(),
                Boolean.TRUE.equals(pedido.consentimiento()), pedido.categoriaCodigo()));
        return RespuestaApi.creado(turno);
    }

    @GetMapping("/{token}")
    ResponseEntity<RespuestaApi<TurnoPublico>> consultar(@PathVariable String token) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(RespuestaApi.ok(consulta.porToken(token)));
    }

    @DeleteMapping("/{token}")
    RespuestaApi<TurnoPublico> cancelar(@PathVariable String token) {
        return RespuestaApi.ok(cancelacion.cancelar(token));
    }

    /** Límite: 6 por minuto e IP. */
    @PostMapping("/{token}/valoracion")
    RespuestaApi<Valoraciones.Valoracion> valorar(@PathVariable String token, @Valid @RequestBody PedidoValoracion pedido,
                                                  HttpServletRequest peticion) {
        if (!limitador.permitir("valoracion", IpCliente.de(peticion), 6)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiadas solicitudes.", 429);
        }
        return RespuestaApi.ok(valoraciones.valorar(token, pedido.estrellas(), pedido.comentario()));
    }

    record PedidoTurno(
            @NotNull @Positive Integer colaId,
            @Size(max = 60) String nombre,
            @Size(max = 20) String telefono,
            Boolean consentimiento,
            @Size(max = 40) String categoriaCodigo) {
    }

    record PedidoValoracion(@NotNull @Min(1) @Max(5) Integer estrellas, @Size(max = 280) String comentario) {
    }
}
