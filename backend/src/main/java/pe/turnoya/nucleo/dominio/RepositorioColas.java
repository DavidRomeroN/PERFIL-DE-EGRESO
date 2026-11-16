package pe.turnoya.nucleo.dominio;

import java.util.List;
import java.util.Optional;

/** Puerto de salida: Colas de atención de cada local. Lo implementa {@code infraestructura.ColasJdbc}. */
public interface RepositorioColas {

    Optional<Cola> porId(int id);

    Optional<Cola> porIdEnLocal(int id, int localId);

    List<Cola> delLocal(int localId);

    List<Cola> activasDelLocal(int localId);

    int contar(int localId);

    int contarTurnos(int colaId);

    int crear(int localId, String prefijo, String nombre, String descripcion, int tiempoAtencionBase, boolean activa, int orden);

    void actualizar(Cola c);

    void eliminar(int id);
}
