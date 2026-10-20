package pe.turnoya.compartido.web;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.datos.Sql;

/**
 * F7: límite de peticiones con ventana fija, guardado en la tabla {@code rate_limit}. Sobrevive a reinicios y lo
 * comparten todas las réplicas (y legacy/ mientras convivan). Si la BD falla no bloquea al usuario.
 */
@Component
public class LimitadorPeticiones {

    private static final Logger log = LoggerFactory.getLogger(LimitadorPeticiones.class);

    private final JdbcClient jdbc;
    private final Clock reloj;
    private final MeterRegistry metricas;

    LimitadorPeticiones(JdbcClient jdbc, Clock reloj, MeterRegistry metricas) {
        this.jdbc = jdbc;
        this.reloj = reloj;
        this.metricas = metricas;
    }

    /** Cuenta la petición y dice si todavía está dentro del máximo ({@code clave:ip}, ventana de 1 minuto). */
    public boolean permitir(String clave, String ip, int maximo) {
        String k = clave + ":" + ip;
        try {
            int contador = incrementar(k, ventana(Duration.ofMinutes(1)));
            boolean permitido = contador <= maximo;
            if (!permitido) {
                metricas.counter("rate_limit_bloqueos_total", "clave", clave).increment();
            }
            return permitido;
        } catch (DataAccessException e) {
            log.warn("rate_limit sin BD: {}", e.getMessage());
            return true;
        }
    }

    /** Valor actual de un contador (p. ej. intentos fallidos de login en la ventana de 15 minutos). */
    public int contador(String clave, Duration ventana) {
        return jdbc.sql("SELECT contador FROM rate_limit WHERE clave = :clave AND ventana = :ventana")
                .param("clave", clave)
                .param("ventana", Sql.utc(ventana(ventana)))
                .query(Integer.class)
                .optional()
                .orElse(0);
    }

    public int incrementar(String clave, Duration ventana) {
        return incrementar(clave, ventana(ventana));
    }

    public void borrar(String clave) {
        jdbc.sql("DELETE FROM rate_limit WHERE clave = :clave").param("clave", clave).update();
    }

    private int incrementar(String clave, Instant inicioVentana) {
        return jdbc.sql("""
                        INSERT INTO rate_limit (clave, ventana, contador) VALUES (:clave, :ventana, 1)
                        ON CONFLICT (clave, ventana) DO UPDATE SET contador = rate_limit.contador + 1
                        RETURNING contador""")
                .param("clave", clave)
                .param("ventana", Sql.utc(inicioVentana))
                .query(Integer.class)
                .single();
    }

    private Instant ventana(Duration largo) {
        long ms = largo.toMillis();
        return Instant.ofEpochMilli(Math.floorDiv(reloj.millis(), ms) * ms);
    }
}
