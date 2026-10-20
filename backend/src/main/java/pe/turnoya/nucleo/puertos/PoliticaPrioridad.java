package pe.turnoya.nucleo.puertos;

import java.util.List;
import java.util.Optional;
import pe.turnoya.nucleo.OrigenCategoria;

/**
 * Atención preferente (M1). Valida la categoría antes de emitir y dice qué categorías puede autodeclarar el
 * cliente. Sin implementación activa no hay prioridades: el orden es FIFO, como el núcleo original.
 */
public interface PoliticaPrioridad {

    boolean aplica(int localId);

    /**
     * Categoría con la que se emite el turno, o vacío para turno general.
     * Lanza {@code ErrorNegocio} si la categoría no existe o el origen no puede usarla.
     */
    Optional<CategoriaAsignada> resolver(int localId, String codigo, OrigenCategoria origen);

    /** Categorías que el cliente puede elegir al tomar turno. */
    List<CategoriaCliente> categoriasParaCliente(int localId);

    record CategoriaAsignada(int id, String codigo) {
    }

    record CategoriaCliente(String codigo, String nombre, String icono, String documento) {
    }
}
