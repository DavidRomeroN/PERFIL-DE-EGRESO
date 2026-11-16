package pe.turnoya.plataforma;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.dominio.RepositorioModulos;

/**
 * Banderas de módulo (F3): un módulo está activo en un local si su plan lo incluye ({@code plan_modulo}) y el
 * admin lo encendió ({@code local_modulo.habilitado}). Con el módulo apagado el sistema se comporta como el núcleo.
 * Caché de 30 s por local, igual que el sistema anterior.
 */
@Service
public class ModulosLocal {

    private static final Duration TTL = Duration.ofSeconds(30);

    private final RepositorioModulos modulos;
    private final Clock reloj;
    private final Map<Integer, Entrada> cache = new ConcurrentHashMap<>();

    ModulosLocal(RepositorioModulos modulos, Clock reloj) {
        this.modulos = modulos;
        this.reloj = reloj;
    }

    public Set<Modulo> activos(int localId) {
        Entrada hit = cache.get(localId);
        Instant ahora = reloj.instant();
        if (hit != null && hit.vence().isAfter(ahora)) {
            return hit.activos();
        }
        Set<Modulo> inmutable = Set.copyOf(modulos.activos(localId));
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

    /** Tras cambiar la matriz de un plan, afecta a todos los locales que lo usan. */
    public void invalidarTodo() {
        cache.clear();
    }

    private record Entrada(Set<Modulo> activos, Instant vence) {
    }
}
