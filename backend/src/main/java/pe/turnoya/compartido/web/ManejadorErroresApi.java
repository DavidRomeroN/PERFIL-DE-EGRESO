package pe.turnoya.compartido.web;

import io.micrometer.core.instrument.MeterRegistry;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authorization.AuthorizationDeniedException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import pe.turnoya.compartido.ErrorNegocio;

/**
 * Filtro global de errores de la API: traduce cada excepción al sobre {@code {ok:false, error:{codigo, mensaje}}}
 * con los mismos códigos y estados HTTP que legacy/ ({@code backend/src/api.ts}).
 */
@RestControllerAdvice(annotations = RestController.class)
@Order(Ordered.HIGHEST_PRECEDENCE)
class ManejadorErroresApi {

    private static final Logger log = LoggerFactory.getLogger(ManejadorErroresApi.class);

    private final MeterRegistry metricas;

    ManejadorErroresApi(MeterRegistry metricas) {
        this.metricas = metricas;
    }

    @ExceptionHandler(ErrorNegocio.class)
    ResponseEntity<Map<String, Object>> negocio(ErrorNegocio e) {
        return responder(e.status(), e.codigo(), e.getMessage(), e.extra());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, Object>> validacion(MethodArgumentNotValidException e) {
        String detalle = e.getBindingResult().getFieldErrors().stream()
                .map(ManejadorErroresApi::describir)
                .collect(Collectors.joining("; "));
        return responder(422, "VALIDACION", detalle.isEmpty() ? "Datos inválidos" : detalle, Map.of());
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<Map<String, Object>> cuerpoInvalido(Exception e) {
        return responder(422, "VALIDACION", "body: datos con formato inválido", Map.of());
    }

    @ExceptionHandler({AccessDeniedException.class, AuthorizationDeniedException.class})
    ResponseEntity<Map<String, Object>> prohibido(Exception e) {
        return responder(403, "PROHIBIDO", "No tienes permiso para esta acción", Map.of());
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<Map<String, Object>> integridad(DataIntegrityViolationException e) {
        String msg = String.valueOf(e.getMostSpecificCause().getMessage());
        if (msg.contains("ux_turno_activo_cliente")) {
            return responder(409, "TURNO_DUPLICADO", "Ya tienes un turno activo en esta cola", Map.of());
        }
        if (msg.contains("duplicate key") || msg.contains("llave duplicada")) {
            return responder(409, "DUPLICADO", "Ya existe un registro con esos datos", Map.of());
        }
        return inesperado(e);
    }

    /** El navegador cerró la conexión (p. ej. una pantalla SSE que se recargó): no hay a quién responder. */
    @ExceptionHandler(AsyncRequestNotUsableException.class)
    void conexionCerrada() {
        // nada que hacer
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, Object>> inesperado(Exception e) {
        log.error("Error inesperado en la API", e);
        return responder(500, "ERROR_INTERNO", "Ocurrió un error inesperado", Map.of());
    }

    private ResponseEntity<Map<String, Object>> responder(int status, String codigo, String mensaje, Map<String, Object> extra) {
        metricas.counter("api_errores_total", "codigo", codigo).increment();
        return RespuestaApi.error(status, codigo, mensaje, extra);
    }

    private static String describir(FieldError error) {
        return error.getField() + ": " + error.getDefaultMessage();
    }
}
