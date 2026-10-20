package pe.turnoya.compartido.web;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.ResponseEntity;

/**
 * Sobre de respuesta de la API (mismo contrato que legacy/):
 * {@code {ok:true, data}} o {@code {ok:false, error:{codigo, mensaje, ...extra}}}.
 */
public record RespuestaApi<T>(boolean ok, T data) {

    public static <T> RespuestaApi<T> ok(T data) {
        return new RespuestaApi<>(true, data);
    }

    public static <T> ResponseEntity<RespuestaApi<T>> creado(T data) {
        return ResponseEntity.status(201).body(ok(data));
    }

    public static ResponseEntity<Map<String, Object>> error(int status, String codigo, String mensaje, Map<String, Object> extra) {
        Map<String, Object> detalle = new LinkedHashMap<>();
        detalle.put("codigo", codigo);
        detalle.put("mensaje", mensaje);
        detalle.putAll(extra);
        Map<String, Object> cuerpo = new LinkedHashMap<>();
        cuerpo.put("ok", false);
        cuerpo.put("error", detalle);
        return ResponseEntity.status(status).body(cuerpo);
    }

    public static ResponseEntity<Map<String, Object>> error(int status, String codigo, String mensaje) {
        return error(status, codigo, mensaje, Map.of());
    }
}
