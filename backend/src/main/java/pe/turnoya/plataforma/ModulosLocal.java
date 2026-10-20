package pe.turnoya.plataforma;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.ErrorNegocio;

/**
 * Banderas de módulo (F3): un módulo está activo en un local si su plan lo incluye ({@code plan_modulo}) y el
 * admin lo encendió ({@code local_modulo.habilitado}). Con el módulo apagado el sistema se comporta como el núcleo.
 * Caché de 30 s por local, igual que legacy/.
 */
@Service
public class ModulosLocal {

    private static final Duration TTL = Duration.ofSeconds(30);

    private final JdbcClient jdbc;
    private final Clock reloj;
    private final Map<Integer, Entrada> cache = new ConcurrentHashMap<>();

    ModulosLocal(JdbcClient jdbc, Clock reloj) {
        this.jdbc = jdbc;
        this.reloj = reloj;
    }

    public Set<Modulo> activos(int localId) {
        Entrada hit = cache.get(localId);
        Instant ahora = reloj.instant();
        if (hit != null && hit.vence().isAfter(ahora)) {
            return hit.activos();
        }
        Set<Modulo> activos = EnumSet.noneOf(Modulo.class);
        jdbc.sql("""
                        SELECT lm.modulo::text AS modulo
                          FROM local_modulo lm
                          JOIN local l ON l.id = lm.local_id
                          JOIN plan_modulo pm ON pm.plan_id = l.plan_id AND pm.modulo = lm.modulo
                         WHERE lm.local_id = :local AND lm.habilitado""")
                .param("local", localId)
                .query(String.class)
                .list()
                .forEach(m -> activos.add(Modulo.valueOf(m)));
        Set<Modulo> inmutable = Set.copyOf(activos);
        cache.put(localId, new Entrada(inmutable, ahora.plus(TTL)));
        return inmutable;
    }

    public boolean activo(int localId, Modulo modulo) {
        return activos(localId).contains(modulo);
    }

    /** 403 {@code MODULO_NO_DISPONIBLE} si el módulo no está activo en el local. */
    public void exigir(int localId, Modulo modulo) {
        if (!activo(localId, modulo)) {
            throw ErrorNegocio.prohibido("MODULO_NO_DISPONIBLE", "El módulo " + modulo.nombre() + " no está activo en este local");
        }
    }

    public void invalidar(int localId) {
        cache.remove(localId);
    }

    private record Entrada(Set<Modulo> activos, Instant vence) {
    }
}
