package pe.turnoya.balanceo.dominio;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Puerto de salida de M6: {@code regla_balanceo}, {@code regla_estado}, {@code ejecucion_regla}, {@code transferencia},
 * las métricas de carga (lectura de {@code turno}) y las acciones sobre {@code ventanilla} y {@code config_prioridad}.
 * Las columnas JSON viajan como texto; las interpreta el caso de uso.
 */
public interface RepositorioBalanceo {

    // --- Reglas ---

    record Estado(String fase, Instant verdaderaDesde, Instant falsaDesde, Instant ultimaEjecucionAt, String estadoAccionJson) {
    }

    record Regla(int id, int localId, String nombre, boolean activa, String modo, String condicionJson, String accionJson, int forSegundos,
                 int forSegundosReversa, int cooldownSeg, int histeresisPct, Integer ttlSeg, boolean requiereConfirmacion, int prioridad,
                 Instant createdAt, Estado estado) {
    }

    record DatosRegla(String nombre, String condicionJson, String accionJson, int forSegundos, int forSegundosReversa, int cooldownSeg,
                      int histeresisPct, Integer ttlSeg, boolean requiereConfirmacion, int prioridad) {
    }

    List<Regla> reglas(int localId);

    List<Regla> activas(int localId);

    Optional<Regla> regla(int id, int localId);

    int contarReglas(int localId);

    int crear(int localId, DatosRegla d, Integer creadoPor);

    void actualizar(int id, DatosRegla d, boolean activa, String modo);

    void eliminar(int id);

    void borrarEstado(int reglaId);

    void guardarEstado(int reglaId, String fase, Instant verdaderaDesde, Instant falsaDesde, Instant ultimaEjecucionAt, String estadoAccionJson);

    List<Integer> localesConReglasActivas();

    /** Candado consultivo por local dentro de la transacción (RNF-M6-02). */
    boolean candado(int localId);

    // --- Ejecuciones ---

    record Ejecucion(long id, int reglaId, String regla, Instant ts, String fase, String resultado, String detalleJson, Integer confirmadaPor) {
    }

    long registrarEjecucion(int reglaId, int localId, String fase, String metricasJson, String resultado, String detalleJson);

    int ejecutadasDesde(int localId, Instant desde);

    List<Ejecucion> ejecuciones(int localId, Integer reglaId, String resultado, Long cursor, int limite);

    Optional<Ejecucion> ejecucion(long id, int localId);

    void resolverEjecucion(long id, String resultado, Integer confirmadaPor, String detalleJson);

    int borrarEjecucionesAntesDe(Instant limite);

    // --- Métricas y carga ---

    record FilaCarga(int colaId, String nombre, int enEspera, Double esperaMaxMin, Double esperaPromMin, int operativas, int ocupadas, int llegadas,
                     int ventanillasActivas) {
    }

    record VentanillaCarga(int id, String nombre, boolean activa, String cola, int atendidosHoy, String atendiendo, boolean temporal) {
    }

    List<FilaCarga> carga(int localId, LocalDate fecha, Instant ahora);

    List<VentanillaCarga> ventanillas(int localId, LocalDate fecha);

    Map<Integer, String> colas(int localId);

    Map<Integer, String> nombresVentanillas(int localId);

    // --- Acciones sobre ventanillas, turnos y prioridades ---

    record VentanillaM6(int id, String nombre, Integer colaId, boolean activa, Integer colaOriginalId, Integer reglaAsignadoraId) {
    }

    Optional<VentanillaM6> ventanilla(int id, int localId);

    /** Ventanilla activa de la cola, sin turno LLAMADO y sin otra regla que ya la haya movido (RN-M6-08). */
    Optional<VentanillaM6> ventanillaLibre(int localId, int colaId, Integer ventanillaId, boolean soloSinRegla);

    void abrirVentanilla(int id, Integer colaId, Integer colaOriginalId, int reglaId);

    void moverVentanilla(int id, int haciaColaId, Integer colaOriginalId, Integer reglaId);

    void revertirMovimiento(int id, int localId, int reglaId, int colaOriginal);

    void revertirApertura(int id, int localId, int reglaId, boolean estabaActiva, Integer colaAnterior);

    /** Los últimos en la fila de la cola (menor prioridad, más recientes): los que más ganan al derivarse. */
    List<Integer> ultimosEnEspera(int localId, int colaId, int cantidad);

    double alfa(int localId);

    void fijarAlfa(int localId, double alfa);

    void recalcularClaves(int localId, LocalDate fecha);

    // --- Transferencias ---

    record Transferible(int id, String codigo, int colaId, String cola, String estado, boolean enEstaVentanilla) {
    }

    /** Turnos del día que se pueden transferir: el llamado en la ventanilla (primero) y los que esperan, en orden de llamada. */
    List<Transferible> transferibles(int localId, LocalDate fecha, Integer ventanillaId, int limite);

    record NuevaTransferencia(int localId, int turnoOrigenId, int turnoDestinoId, int deColaId, int aColaId, Integer aVentanillaId, String motivo,
                              String detalle, String origen, Integer reglaId, Integer usuarioId) {
    }

    record Transferencia(int id, int turnoOrigenId, int turnoDestinoId, String codigoOrigen, String codigoDestino, String deCola, String aCola,
                         String motivo, String detalle, String origen, Integer reglaId, Integer usuarioId, Instant createdAt) {
    }

    void registrarTransferencia(NuevaTransferencia t);

    List<Transferencia> transferencias(int localId, Instant desde, Instant hasta, Integer cursor, int limite);
}
