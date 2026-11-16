package pe.turnoya.prediccion.estimacion;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.prediccion.dominio.ModelosEspera;
import pe.turnoya.prediccion.dominio.ModelosEspera.Estado;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion;

/**
 * Modelo activo por cola en memoria (30 s; se invalida al reentrenar o al cambiar la configuración). Sin modelo
 * entrenado arranca en frío: BASELINE con el tiempo base de la cola y los últimos 10 servicios reales.
 */
@Component
public class ModelosActivos {

    private static final Duration VIGENCIA = Duration.ofSeconds(30);

    private final RepositorioPrediccion repositorio;
    private final CatalogoLocales locales;
    private final Clock reloj;
    private final Map<Integer, Entrada> cache = new ConcurrentHashMap<>();

    ModelosActivos(RepositorioPrediccion repositorio, CatalogoLocales locales, Clock reloj) {
        this.repositorio = repositorio;
        this.locales = locales;
        this.reloj = reloj;
    }

    /** {@code id} nulo = arranque en frío (no hay modelo guardado que actualizar). */
    public record Entrada(Instant at, Integer id, int version, Estado estado) {
    }

    public record Franja(int dow, int franja) {
    }

    public Entrada de(int colaId) {
        Entrada hit = cache.get(colaId);
        Instant ahora = reloj.instant();
        if (hit != null && Duration.between(hit.at(), ahora).compareTo(VIGENCIA) < 0) {
            return hit;
        }
        Entrada e = repositorio.modeloActivo(colaId)
                .map(m -> new Entrada(ahora, m.id(), m.version(), m.estado()))
                .orElseGet(() -> {
                    int base = repositorio.cola(colaId).map(RepositorioPrediccion.ColaInfo::tiempoAtencionBase).orElse(300);
                    Estado est = ModelosEspera.estadoInicial(ModelosEspera.Tipo.BASELINE, base, 0.2);
                    repositorio.ultimosServicios(colaId, 10).forEach(s -> ModelosEspera.actualizarServicio(est, s, 0, 0));
                    return new Entrada(ahora, null, 0, est);
                });
        cache.put(colaId, e);
        return e;
    }

    public void invalidar(int colaId) {
        cache.remove(colaId);
    }

    public void invalidarTodo() {
        cache.clear();
    }

    /** RN-M2-04: ventanillas operativas = con un llamado en los últimos 15 min o un turno LLAMADO ahora; mínimo 1. */
    public int ventanillasOperativas(int colaId, Instant ahora) {
        int recientes = repositorio.ventanillasConActividad(colaId, ahora.minus(Duration.ofMinutes(15)));
        if (recientes > 0) {
            return recientes;
        }
        // Sin actividad reciente (inicio del día): se asume que atienden las ventanillas activas asignadas a la cola
        return Math.max(1, repositorio.ventanillasActivasAsignadas(colaId));
    }

    /** Día de la semana (0 = domingo) y franja de 30 min del instante en la zona del local. */
    public Franja franja(int localId, Instant instante) {
        ZoneId zona = locales.porId(localId).map(l -> l.zonaHoraria()).orElse(Fechas.LIMA);
        var p = Fechas.partes(zona, instante);
        return new Franja(p.diaSemana(), p.hora() * 2 + p.minuto() / 30);
    }
}
