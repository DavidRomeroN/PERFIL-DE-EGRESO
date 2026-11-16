package pe.turnoya.plataforma.pagos;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.pagos.SuscripcionPlanes.Resultado;

/** {@code /api/v1/public/registro} y el estado de su pago, mismo contrato que el sistema anterior. */
@RestController
class RegistroApi {

    private final RegistroPublico registro;
    private final LimitadorPeticiones limitador;

    RegistroApi(RegistroPublico registro, LimitadorPeticiones limitador) {
        this.registro = registro;
        this.limitador = limitador;
    }

    /** 201 si el local quedó creado; 202 si el pago está en revisión. */
    @PostMapping("/api/v1/public/registro")
    ResponseEntity<RespuestaApi<Resultado>> registrar(@RequestBody RegistroPublico.Solicitud solicitud, HttpServletRequest peticion) {
        if (!limitador.permitir("registro", IpCliente.de(peticion), 5)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiados intentos. Espera un minuto.", 429);
        }
        Resultado r = registro.registrar(solicitud);
        return ResponseEntity.status(r.estado().equals("APROBADO") ? HttpStatus.CREATED : HttpStatus.ACCEPTED).body(RespuestaApi.ok(r));
    }

    @GetMapping("/api/v1/public/pagos/{id}")
    RespuestaApi<Resultado> estado(@PathVariable int id, @RequestParam(defaultValue = "") String clave, HttpServletRequest peticion) {
        if (!limitador.permitir("pago-estado", IpCliente.de(peticion), 30)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiadas solicitudes.", 429);
        }
        return RespuestaApi.ok(registro.estado(id, clave));
    }
}
