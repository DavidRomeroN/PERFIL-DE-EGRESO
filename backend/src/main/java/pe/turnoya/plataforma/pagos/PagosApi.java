package pe.turnoya.plataforma.pagos;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.dominio.PasarelaPagos;
import pe.turnoya.plataforma.dominio.PasarelaPagos.Tarjeta;

/** {@code /api/v1/pagos} (Mi plan) y el webhook de Mercado Pago, mismo contrato que el sistema anterior. */
@RestController
class PagosApi {

    private final SuscripcionPlanes suscripcion;
    private final LocalDeTrabajo localDeTrabajo;
    private final LimitadorPeticiones limitador;
    private final PasarelaPagos pasarela;

    PagosApi(SuscripcionPlanes suscripcion, LocalDeTrabajo localDeTrabajo, LimitadorPeticiones limitador, PasarelaPagos pasarela) {
        this.suscripcion = suscripcion;
        this.localDeTrabajo = localDeTrabajo;
        this.limitador = limitador;
        this.pasarela = pasarela;
    }

    @SoloAdmin
    @GetMapping("/api/v1/pagos")
    RespuestaApi<SuscripcionPlanes.MiPlan> miPlan(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(suscripcion.miPlan(localDeTrabajo.resolver(sesion, peticion)));
    }

    /** Cambia o renueva el plan pagando con la tarjeta tokenizada por el Card Payment Brick. */
    @SoloAdmin
    @PostMapping("/api/v1/pagos/plan")
    ResponseEntity<RespuestaApi<SuscripcionPlanes.Resultado>> pagar(@AuthenticationPrincipal Sesion sesion, @RequestBody PagoPlan b,
                                                                     HttpServletRequest peticion) {
        if (!limitador.permitir("pago-plan", IpCliente.de(peticion), 5)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiados intentos. Espera un minuto.", 429);
        }
        var r = suscripcion.pagarPlan(localDeTrabajo.resolver(sesion, peticion), b.plan(), b.meses() == null ? 1 : b.meses(), b.tarjeta(),
                b.claveIdem(), Auditoria.Actor.de(sesion, peticion));
        return ResponseEntity.status(r.estado().equals("APROBADO") ? HttpStatus.CREATED : HttpStatus.ACCEPTED).body(RespuestaApi.ok(r));
    }

    /** Notificación de Mercado Pago: se verifica la firma y se vuelve a consultar el cobro. Responde 200 para que no reintente. */
    @PostMapping("/api/v1/webhooks/mercadopago")
    Map<String, Object> webhook(@RequestHeader(value = "x-signature", required = false) String firma,
                                @RequestHeader(value = "x-request-id", required = false) String requestId,
                                @RequestParam(value = "data.id", required = false) String dataIdParam,
                                @RequestParam(value = "type", required = false) String tipo,
                                @RequestBody(required = false) Map<String, Object> cuerpo) {
        String dataId = dataIdParam;
        if (dataId == null && cuerpo != null && cuerpo.get("data") instanceof Map<?, ?> data && data.get("id") != null) {
            dataId = String.valueOf(data.get("id"));
        }
        String tipoEvento = tipo != null ? tipo : cuerpo == null ? null : String.valueOf(cuerpo.get("type"));
        if (dataId == null || !"payment".equals(tipoEvento)) {
            return Map.of("ok", true, "ignorado", true);
        }
        if (!pasarela.firmaValida(firma, requestId, dataId)) {
            return Map.of("ok", false, "error", "firma inválida");
        }
        return Map.of("ok", true, "estado", suscripcion.procesarNotificacion(dataId));
    }

    record PagoPlan(String plan, Integer meses, String claveIdem, Tarjeta tarjeta) {
    }
}
