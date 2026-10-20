package pe.turnoya.plataforma.web;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.tareas.PlanificadorTareas;

/** {@code /api/health} (F1): estado de la BD y tareas atrasadas, con el mismo formato que legacy/. */
@RestController
class SaludApi {

    private final JdbcClient jdbc;
    private final PlanificadorTareas tareas;
    private final Clock reloj;

    SaludApi(JdbcClient jdbc, PlanificadorTareas tareas, Clock reloj) {
        this.jdbc = jdbc;
        this.tareas = tareas;
        this.reloj = reloj;
    }

    @GetMapping("/api/health")
    ResponseEntity<Map<String, Object>> salud() {
        long inicio = System.currentTimeMillis();
        Map<String, Object> cuerpo = new LinkedHashMap<>();
        try {
            jdbc.sql("SELECT 1").query(Integer.class).single();
            Instant ahora = reloj.instant();
            List<PlanificadorTareas.EstadoTarea> estado = tareas.estado();
            List<String> atrasadas = estado.stream()
                    .filter(t -> t.proxima() != null && Duration.between(t.proxima(), ahora).toMinutes() > 5)
                    .map(PlanificadorTareas.EstadoTarea::nombre)
                    .toList();
            cuerpo.put("status", atrasadas.isEmpty() ? "ok" : "degraded");
            cuerpo.put("db", "up");
            cuerpo.put("latencyMs", System.currentTimeMillis() - inicio);
            cuerpo.put("jobs", estado.stream().map(t -> {
                Map<String, Object> j = new LinkedHashMap<>();
                j.put("nombre", t.nombre());
                j.put("ultimaCorrida", t.ultimaCorrida());
                j.put("ultimoError", t.ultimoError());
                j.put("fallos", t.fallos());
                return j;
            }).toList());
            cuerpo.put("jobsAtrasados", atrasadas);
            cuerpo.put("at", ahora);
            return ResponseEntity.ok(cuerpo);
        } catch (RuntimeException e) {
            cuerpo.put("status", "degraded");
            cuerpo.put("db", "down");
            cuerpo.put("error", e.getMessage());
            return ResponseEntity.status(503).body(cuerpo);
        }
    }
}
