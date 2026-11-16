package pe.turnoya.plataforma.dominio;

import java.util.Set;
import pe.turnoya.plataforma.Modulo;

/** Puerto de salida: módulos que el plan incluye y el admin encendió. Lo implementa {@code infraestructura.ModulosJdbc}. */
public interface RepositorioModulos {

    Set<Modulo> activos(int localId);

    /** Módulos que incluye el plan actual del local. */
    Set<Modulo> incluidos(int localId);

    /** Interruptores del local (aunque el plan ya no incluya el módulo). */
    Set<Modulo> encendidos(int localId);

    void cambiar(int localId, Modulo modulo, boolean habilitado);

    /** Enciende en el local todos los módulos que incluye su plan (alta de local o pago de plan). */
    void encenderDelPlan(int localId);
}
