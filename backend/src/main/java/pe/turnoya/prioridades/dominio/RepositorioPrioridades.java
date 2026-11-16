package pe.turnoya.prioridades.dominio;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/** Puerto de salida de M1: categorías, configuración y prioridad de los turnos. Lo implementa {@code infraestructura.PrioridadesJdbc}. */
public interface RepositorioPrioridades {

    ReglasPrioridad.Config config(int localId);

    void guardarConfig(int localId, ReglasPrioridad.Config config);

    List<CategoriaFila> categorias(int localId);

    Optional<CategoriaFila> categoria(int localId, int id);

    Optional<CategoriaFila> activaPorCodigo(int localId, String codigo);

    /** Preferentes activas (sin GENERAL ni CITA), para el límite del plan Emprende. */
    int preferentesActivas(int localId, Integer excepto);

    CategoriaFila crear(int localId, DatosCategoria datos);

    CategoriaFila editar(int id, DatosCategoria datos);

    int turnosConCategoria(int id);

    void desactivar(int id);

    void eliminar(int id);

    /** Crea las categorías y la configuración por defecto (idempotente). */
    void sembrar(int localId);

    /** Recalcula en una sentencia la clave de los turnos en espera desde {@code fecha} (RN-M1-05). */
    int recalcular(int localId, LocalDate fecha);

    Optional<TurnoEspera> turno(int localId, int turnoId);

    /** El siguiente en espera según la clave (para la explicación del panel). */
    Optional<TurnoEspera> siguiente(int localId, LocalDate fecha, Integer colaId);

    void verificar(int turnoId);

    /** Cambia la categoría y recalcula la clave conservando la hora de emisión (RN-M1-04). */
    void cambiarCategoria(int localId, int turnoId, Integer categoriaId, boolean verificada);

    record CategoriaFila(int id, String codigo, String nombre, String icono, int pesoBase, boolean absoluta, String documento, Integer esperaMaxSeg,
                         boolean visibleCliente, boolean activa, int orden) {

        public ReglasPrioridad.Categoria regla() {
            return new ReglasPrioridad.Categoria(codigo, pesoBase, absoluta);
        }
    }

    record DatosCategoria(String codigo, String nombre, String icono, int pesoBase, boolean absoluta, String documento, Integer esperaMaxSeg,
                          boolean visibleCliente, boolean activa, int orden) {
    }

    record TurnoEspera(int id, String codigo, int colaId, String estado, Instant emitidoAt, CategoriaFila categoria, Boolean verificada) {
    }
}
