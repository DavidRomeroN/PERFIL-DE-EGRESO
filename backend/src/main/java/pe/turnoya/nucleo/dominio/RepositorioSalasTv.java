package pe.turnoya.nucleo.dominio;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** Salas de TV combinadas que guarda el administrador (varias colas en un mismo televisor). */
public interface RepositorioSalasTv {

    record SalaTv(int id, int localId, String nombre, List<Integer> colaIds, Instant creadaAt) {
    }

    List<SalaTv> delLocal(int localId);

    Optional<SalaTv> porId(int localId, int id);

    int crear(int localId, String nombre, List<Integer> colaIds);

    void eliminar(int localId, int id);
}
