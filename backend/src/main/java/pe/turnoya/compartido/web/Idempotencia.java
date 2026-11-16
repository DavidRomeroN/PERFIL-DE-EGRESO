package pe.turnoya.compartido.web;

import java.time.Clock;
import java.time.Duration;
import java.util.function.Supplier;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.datos.Sql;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Cabecera {@code Idempotency-Key} (igual que {@code conIdempotencia} del sistema anterior): la misma clave en la misma
 * ruta devuelve la respuesta guardada durante 24 h (con {@code Idempotent-Replay: true}) en lugar de repetir la operación.
 */
@Component
public class Idempotencia {

    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final Clock reloj;

    Idempotencia(JdbcClient jdbc, ObjectMapper json, Clock reloj) {
        this.jdbc = jdbc;
        this.json = json;
        this.reloj = reloj;
    }

    public ResponseEntity<?> ejecutar(String clave, String ruta, int status, Supplier<Object> operacion) {
        if (clave == null || clave.isBlank()) {
            return ResponseEntity.status(status).body(RespuestaApi.ok(operacion.get()));
        }
        if (clave.length() > 120) {
            throw new ErrorNegocio("VALIDACION", "Idempotency-Key demasiado larga", 422);
        }
        var previa = jdbc.sql("SELECT status, respuesta::text AS r FROM idempotencia WHERE ruta = ? AND clave = ? AND expira_at > ?")
                .params(ruta, clave, Sql.utc(reloj.instant()))
                .query((rs, n) -> new Object[] {rs.getInt("status"), rs.getString("r")}).optional();
        if (previa.isPresent()) {
            JsonNode data = json.readTree((String) previa.get()[1]);
            return ResponseEntity.status((Integer) previa.get()[0]).header("Idempotent-Replay", "true").body(RespuestaApi.ok(data));
        }
        Object data = operacion.get();
        try {
            jdbc.sql("""
                    INSERT INTO idempotencia (ruta, clave, status, respuesta, expira_at) VALUES (?, ?, ?, ?::jsonb, ?)
                    ON CONFLICT (ruta, clave) DO UPDATE SET status = EXCLUDED.status, respuesta = EXCLUDED.respuesta, expira_at = EXCLUDED.expira_at
                    """)
                    .params(ruta, clave, status, json.writeValueAsString(data), Sql.utc(reloj.instant().plus(Duration.ofDays(1)))).update();
        } catch (RuntimeException ignorada) {
            // Igual que el sistema anterior: si no se pudo guardar, la operación ya se hizo
        }
        return ResponseEntity.status(status).body(RespuestaApi.ok(data));
    }
}
