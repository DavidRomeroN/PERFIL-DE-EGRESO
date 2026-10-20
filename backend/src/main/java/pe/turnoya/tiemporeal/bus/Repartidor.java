package pe.turnoya.tiemporeal.bus;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** Suscriptores conectados a ESTA instancia, agrupados por local. */
@Component
public class Repartidor {

    private static final Logger log = LoggerFactory.getLogger(Repartidor.class);

    private final Map<Integer, Set<Consumer<EventoTiempoReal>>> porLocal = new ConcurrentHashMap<>();

    public Runnable suscribir(int localId, Consumer<EventoTiempoReal> suscriptor) {
        porLocal.computeIfAbsent(localId, k -> ConcurrentHashMap.newKeySet()).add(suscriptor);
        return () -> porLocal.computeIfPresent(localId, (k, set) -> {
            set.remove(suscriptor);
            return set.isEmpty() ? null : set;
        });
    }

    public void repartir(EventoTiempoReal evento) {
        for (Consumer<EventoTiempoReal> s : porLocal.getOrDefault(evento.localId(), Set.of())) {
            try {
                s.accept(evento);
            } catch (RuntimeException e) {
                log.debug("Suscriptor descartado: {}", e.getMessage());
            }
        }
    }

    public int conexiones() {
        return porLocal.values().stream().mapToInt(Set::size).sum();
    }
}
