package pe.turnoya.nucleo.pantalla;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.nucleo.dominio.Cola;
import pe.turnoya.nucleo.dominio.RepositorioColas;
import pe.turnoya.nucleo.dominio.RepositorioSalasTv;
import pe.turnoya.nucleo.dominio.RepositorioSalasTv.SalaTv;
import pe.turnoya.plataforma.Auditoria;

/** Crear y eliminar salas de TV combinadas (varias colas en un mismo televisor). */
@Service
class GestionSalasTv {

    static final int MAX_SALAS = 20;
    static final int MAX_NOMBRE = 60;

    private final RepositorioSalasTv salas;
    private final RepositorioColas colas;
    private final Auditoria auditoria;

    GestionSalasTv(RepositorioSalasTv salas, RepositorioColas colas, Auditoria auditoria) {
        this.salas = salas;
        this.colas = colas;
        this.auditoria = auditoria;
    }

    List<SalaTv> delLocal(int localId) {
        return salas.delLocal(localId);
    }

    @Transactional
    public SalaTv crear(int localId, String nombre, List<Integer> colaIds, Auditoria.Actor actor) {
        List<Cola> activas = colas.activasDelLocal(localId);
        Set<Integer> pedidas = colaIds == null ? Set.of() : Set.copyOf(colaIds);
        List<Cola> marcadas = activas.stream().filter(c -> pedidas.contains(c.id())).toList();
        if (marcadas.size() < 2) {
            throw new ErrorNegocio("SALA_TV_INVALIDA", "Marca al menos dos colas para la sala.", 422);
        }
        if (marcadas.size() == activas.size()) {
            throw new ErrorNegocio("SALA_TV_INVALIDA", "Con todas las colas usa el enlace «Todo el local».", 422);
        }
        List<Integer> ids = marcadas.stream().map(Cola::id).sorted().toList();
        List<SalaTv> existentes = salas.delLocal(localId);
        if (existentes.stream().anyMatch(s -> s.colaIds().stream().sorted().toList().equals(ids))) {
            throw ErrorNegocio.conflicto("SALA_TV_DUPLICADA", "Ya hay una sala con esas mismas colas.");
        }
        if (existentes.size() >= MAX_SALAS) {
            throw ErrorNegocio.conflicto("SALA_TV_LIMITE", "Puedes guardar hasta " + MAX_SALAS + " salas: elimina una para crear otra.");
        }
        String n = nombre == null || nombre.isBlank() ? marcadas.stream().map(Cola::nombre).collect(Collectors.joining(" + ")) : nombre.trim();
        if (n.length() > MAX_NOMBRE) {
            n = n.substring(0, MAX_NOMBRE).trim();
        }
        auditoria.fijarActor(actor);
        int id = salas.crear(localId, n, ids);
        auditoria.registrar(actor, localId, "SALA_TV_CREAR", "sala_tv", id, "Creó la pantalla de sala «" + n + "»", null);
        return salas.porId(localId, id).orElseThrow();
    }

    @Transactional
    public SalaTv eliminar(int localId, int id, Auditoria.Actor actor) {
        SalaTv sala = salas.porId(localId, id).orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "La pantalla ya no existe"));
        auditoria.fijarActor(actor);
        salas.eliminar(localId, id);
        auditoria.registrar(actor, localId, "SALA_TV_ELIMINAR", "sala_tv", id, "Eliminó la pantalla de sala «" + sala.nombre() + "»", null);
        return sala;
    }
}
