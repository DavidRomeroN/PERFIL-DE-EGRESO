package pe.turnoya.nucleo.dominio;

import java.util.List;
import java.util.Optional;

/** Puerto de salida: Ventanillas de atención de cada local. Lo implementa {@code infraestructura.VentanillasJdbc}. */
public interface RepositorioVentanillas {

    Optional<Ventanilla> porIdEnLocal(int id, int localId);

    List<Ventanilla> delLocal(int localId);

    List<Ventanilla> activasDelLocal(int localId);

    int contar(int localId);

    int contarTurnos(int ventanillaId);

    int crear(int localId, String nombre, Integer colaId, boolean activa);

    void actualizar(Ventanilla v);

    void eliminar(int id);
}
