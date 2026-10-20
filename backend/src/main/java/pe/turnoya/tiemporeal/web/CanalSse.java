package pe.turnoya.tiemporeal.web;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.tiemporeal.bus.EventoTiempoReal;
import pe.turnoya.tiemporeal.bus.Repartidor;
import tools.jackson.databind.ObjectMapper;

/**
 * {@code GET /api/v1/realtime/:slug}: canal Server-Sent Events del local.
 *
 * <p>Público: {@code cola:actualizada}, {@code turno:llamado}, {@code turno:estado}, {@code notificacion:nueva}
 * (sin datos personales). Personal del local: todos los eventos con sus datos. Ping cada 20 s para que proxies y
 * celulares no corten la conexión; el navegador ({@code EventSource}) reconecta solo.
 *
 * <p>Las conexiones no ocupan un hilo mientras esperan (procesamiento asíncrono de Spring MVC sobre hilos virtuales).
 */
@RestController
class CanalSse {

    private static final Duration DURACION_MAXIMA = Duration.ofMinutes(30);

    private final CatalogoLocales locales;
    private final Repartidor repartidor;
    private final ObjectMapper json;
    private final Clock reloj;
    private final Set<Conexion> conexiones = ConcurrentHashMap.newKeySet();

    CanalSse(CatalogoLocales locales, Repartidor repartidor, ObjectMapper json, Clock reloj, MeterRegistry metricas) {
        this.locales = locales;
        this.repartidor = repartidor;
        this.json = json;
        this.reloj = reloj;
        Gauge.builder("sse_conexiones", conexiones, Set::size).register(metricas);
    }

    @GetMapping(path = "/api/v1/realtime/{slug}", produces = "text/event-stream")
    ResponseEntity<SseEmitter> conectar(@PathVariable String slug, @AuthenticationPrincipal Sesion sesion) {
        Local local = locales.porSlug(slug).filter(Local::activo).orElse(null);
        if (local == null) {
            return ResponseEntity.notFound().build();
        }
        boolean personal = sesion != null && (sesion.esSuperAdmin() || Integer.valueOf(local.id()).equals(sesion.localId()));
        SseEmitter emisor = new SseEmitter(DURACION_MAXIMA.toMillis());
        Conexion conexion = new Conexion(emisor);
        Runnable cancelar = repartidor.suscribir(local.id(), evento -> {
            EventoTiempoReal visible = personal ? evento : evento.paraPublico();
            if (visible != null) {
                conexion.enviar(visible.tipo(), json.writeValueAsString(visible.comoJson()));
            }
        });
        Runnable cerrar = () -> {
            cancelar.run();
            conexiones.remove(conexion);
        };
        emisor.onCompletion(cerrar);
        emisor.onTimeout(cerrar);
        emisor.onError(e -> cerrar.run());
        conexiones.add(conexion);
        conexion.enviar("conectado", json.writeValueAsString(Map.of("localId", local.id(), "at", reloj.instant().toString())));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache().noTransform())
                .header("X-Accel-Buffering", "no")
                .body(emisor);
    }

    @Scheduled(fixedRate = 20_000)
    void ping() {
        for (Conexion c : conexiones) {
            c.ping(reloj.millis());
        }
    }

    /** Envíos serializados por conexión (un SseEmitter no admite escrituras concurrentes). */
    private static final class Conexion {
        private final SseEmitter emisor;

        Conexion(SseEmitter emisor) {
            this.emisor = emisor;
        }

        synchronized void enviar(String evento, String datos) {
            try {
                emisor.send(SseEmitter.event().name(evento).data(datos));
            } catch (IOException | IllegalStateException e) {
                emisor.completeWithError(e);
            }
        }

        synchronized void ping(long ahora) {
            try {
                emisor.send(SseEmitter.event().comment("ping " + ahora));
            } catch (IOException | IllegalStateException e) {
                emisor.completeWithError(e);
            }
        }
    }
}
