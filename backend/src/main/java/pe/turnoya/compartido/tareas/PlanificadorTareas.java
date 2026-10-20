package pe.turnoya.compartido.tareas;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.datos.Sql;
import tools.jackson.databind.ObjectMapper;

/**
 * Planificador de tareas (F1). Cada 5 s revisa las tareas y reclama las que tocan con
 * {@code UPDATE job_estado … WHERE proxima <= ahora RETURNING}: es la misma tabla y la misma regla que usa legacy/,
 * así que mientras convivan, una corrida nunca se ejecuta dos veces (riesgo 2 del plan de migración).
 *
 * <p>Las tareas corren en hilos virtuales; si una sigue en curso, no se vuelve a lanzar.
 * {@code turnoya.jobs-habilitados=false} las apaga (p. ej. en una réplica solo web o en pruebas).
 */
@Component
public class PlanificadorTareas {

    private static final Logger log = LoggerFactory.getLogger(PlanificadorTareas.class);

    private final List<TareaProgramada> tareas;
    private final JdbcClient jdbc;
    private final Clock reloj;
    private final PropiedadesTurnoYa propiedades;
    private final MeterRegistry metricas;
    private final ObjectMapper json;
    private final Set<String> enCurso = ConcurrentHashMap.newKeySet();
    private final ExecutorService ejecutor = Executors.newVirtualThreadPerTaskExecutor();

    PlanificadorTareas(List<TareaProgramada> tareas, JdbcClient jdbc, Clock reloj, PropiedadesTurnoYa propiedades,
                       MeterRegistry metricas, ObjectMapper json) {
        this.tareas = tareas;
        this.jdbc = jdbc;
        this.reloj = reloj;
        this.propiedades = propiedades;
        this.metricas = metricas;
        this.json = json;
    }

    @Scheduled(initialDelay = 5_000, fixedDelay = 5_000)
    void revisar() {
        if (!propiedades.jobsHabilitados()) {
            return;
        }
        Instant ahora = reloj.instant();
        for (TareaProgramada tarea : tareas) {
            if (enCurso.contains(tarea.nombre())) {
                continue;
            }
            try {
                if (reclamar(tarea, ahora)) {
                    enCurso.add(tarea.nombre());
                    ejecutor.submit(() -> ejecutar(tarea));
                }
            } catch (RuntimeException e) {
                log.warn("No se pudo reclamar la tarea {}: {}", tarea.nombre(), e.getMessage());
            }
        }
    }

    /** Ejecuta una tarea ya (botón "ejecutar ahora" del panel de jobs). */
    public Object ejecutarAhora(String nombre) {
        TareaProgramada tarea = tareas.stream().filter(t -> t.nombre().equals(nombre)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Tarea desconocida: " + nombre));
        if (!enCurso.add(nombre)) {
            return java.util.Map.of("omitida", true);
        }
        return ejecutar(tarea);
    }

    public List<EstadoTarea> estado() {
        return tareas.stream().map(t -> jdbc.sql("""
                        SELECT ultima_corrida, ultimo_error, fallos, corridas, proxima FROM job_estado WHERE nombre = :nombre""")
                .param("nombre", t.nombre())
                .query((rs, i) -> new EstadoTarea(t.nombre(), t.descripcion(), t.frecuencia(),
                        Sql.instante(rs, "ultima_corrida"), rs.getString("ultimo_error"), rs.getInt("corridas"),
                        rs.getInt("fallos"), Sql.instante(rs, "proxima"), enCurso.contains(t.nombre())))
                .optional()
                .orElse(new EstadoTarea(t.nombre(), t.descripcion(), t.frecuencia(), null, null, 0, 0, null, false)))
                .toList();
    }

    private boolean reclamar(TareaProgramada tarea, Instant ahora) {
        jdbc.sql("INSERT INTO job_estado (nombre, proxima) VALUES (:nombre, :proxima) ON CONFLICT (nombre) DO NOTHING")
                .param("nombre", tarea.nombre())
                .param("proxima", Sql.utc(tarea.esPeriodica() ? ahora : tarea.proxima(ahora)))
                .update();
        return !jdbc.sql("""
                        UPDATE job_estado SET proxima = :siguiente
                         WHERE nombre = :nombre AND (proxima IS NULL OR proxima <= :ahora)
                        RETURNING nombre""")
                .param("siguiente", Sql.utc(tarea.proxima(ahora)))
                .param("nombre", tarea.nombre())
                .param("ahora", Sql.utc(ahora))
                .query(String.class)
                .list()
                .isEmpty();
    }

    private Object ejecutar(TareaProgramada tarea) {
        long t0 = System.nanoTime();
        try {
            Object resultado = tarea.accion().get();
            int ms = (int) TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - t0);
            metricas.counter("job_corridas_total", "job", tarea.nombre(), "resultado", "ok").increment();
            metricas.timer("job_duracion", "job", tarea.nombre()).record(ms, TimeUnit.MILLISECONDS);
            registrar(tarea, ms, resultado, null);
            return resultado;
        } catch (RuntimeException e) {
            int ms = (int) TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - t0);
            metricas.counter("job_corridas_total", "job", tarea.nombre(), "resultado", "error").increment();
            log.error("La tarea {} falló", tarea.nombre(), e);
            registrar(tarea, ms, null, String.valueOf(e.getMessage()));
            return java.util.Map.of("error", String.valueOf(e.getMessage()));
        } finally {
            enCurso.remove(tarea.nombre());
        }
    }

    private void registrar(TareaProgramada tarea, int ms, Object resultado, String error) {
        try {
            jdbc.sql("""
                            UPDATE job_estado
                               SET ultima_corrida = :ahora, ultima_duracion_ms = :ms, corridas = corridas + 1,
                                   ultimo_resultado = CAST(:resultado AS jsonb),
                                   ultimo_error = :error,
                                   fallos = fallos + :fallo
                             WHERE nombre = :nombre""")
                    .param("ahora", Sql.utc(reloj.instant()))
                    .param("ms", ms)
                    .param("resultado", resultado == null ? null : json.writeValueAsString(resultado))
                    .param("error", error == null ? null : error.substring(0, Math.min(500, error.length())))
                    .param("fallo", error == null ? 0 : 1)
                    .param("nombre", tarea.nombre())
                    .update();
        } catch (RuntimeException e) {
            log.warn("No se pudo guardar el estado de la tarea {}: {}", tarea.nombre(), e.getMessage());
        }
    }

    @PreDestroy
    void cerrar() {
        ejecutor.shutdown();
    }

    public record EstadoTarea(String nombre, String descripcion, String frecuencia, Instant ultimaCorrida, String ultimoError,
                              int corridas, int fallos, Instant proxima, boolean enCurso) {
    }
}
