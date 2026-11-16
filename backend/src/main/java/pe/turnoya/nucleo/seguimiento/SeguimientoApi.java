package pe.turnoya.nucleo.seguimiento;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
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
import pe.turnoya.nucleo.dominio.Valoracion;

/** API pública del turno del cliente: consultarlo (RF02), cancelarlo (RF04) y valorarlo (N07). */
@RestController
@RequestMapping("/api/v1/public/turnos/{token}")
class SeguimientoApi {

    private final ConsultaTurnos consulta;
    private final CancelacionTurnos cancelacion;
    private final Valoraciones valoraciones;
    private final LimitadorPeticiones limitador;

    SeguimientoApi(ConsultaTurnos consulta, CancelacionTurnos cancelacion, Valoraciones valoraciones, LimitadorPeticiones limitador) {
        this.consulta = consulta;
        this.cancelacion = cancelacion;
        this.valoraciones = valoraciones;
        this.limitador = limitador;
    }

    @GetMapping
    ResponseEntity<RespuestaApi<TurnoPublico>> consultar(@PathVariable String token) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(RespuestaApi.ok(consulta.porToken(token)));
    }

    @DeleteMapping
    RespuestaApi<TurnoPublico> cancelar(@PathVariable String token) {
        return RespuestaApi.ok(cancelacion.cancelar(token));
    }

    /** Límite: 6 por minuto e IP. */
    @PostMapping("/valoracion")
    RespuestaApi<Valoracion> valorar(@PathVariable String token, @Valid @RequestBody PedidoValoracion pedido, HttpServletRequest peticion) {
        if (!limitador.permitir("valoracion", IpCliente.de(peticion), 6)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiadas solicitudes.", 429);
        }
        return RespuestaApi.ok(valoraciones.valorar(token, pedido.estrellas(), pedido.comentario()));
    }

    record PedidoValoracion(@NotNull @Min(1) @Max(5) Integer estrellas, @Size(max = 280) String comentario) {
    }
}
