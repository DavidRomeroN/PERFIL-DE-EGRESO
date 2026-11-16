package pe.turnoya.prediccion.dominio;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import pe.turnoya.prediccion.dominio.ModelosEspera.Estado;
import pe.turnoya.prediccion.dominio.ModelosEspera.Importancia;
import pe.turnoya.prediccion.dominio.ModelosEspera.Tipo;

/** Puerto de salida de M2: configuración, modelos entrenados, bitácora de predicciones y datos de los turnos. */
public interface RepositorioPrediccion {

    /** Configuración del local (los valores por defecto si aún no la guardó). Solo lectura. */
    Config config(int localId);

    void guardarConfig(int localId, Config config);

    Optional<ColaInfo> cola(int colaId);

    List<Integer> colasActivas(int localId, Integer soloColaId);

    /** Colas activas del local con su nombre, en el orden del local (para elegir en la administración). */
    List<ColaNombre> colasConNombre(int localId);

    record ColaNombre(int id, String nombre) {
    }

    /**
     * Cuánto esperan los clientes de cada cola activa (minutos desde que sacan el turno hasta que los llaman): hoy y en
     * los últimos días ({@code desde}..{@code hoy}), con el valor que no supera 9 de cada 10.
     */
    List<EsperaCola> esperasPorCola(int localId, java.time.LocalDate hoy, java.time.LocalDate desde);

    record EsperaCola(int colaId, String cola, int esperandoAhora, int atendidosHoy, Double promedioHoyMin, int atendidosPeriodo,
                      Double promedioPeriodoMin, Double p90PeriodoMin) {
    }

    /** Servicios (segundos) de los últimos {@code n} atendidos, del más antiguo al más reciente. */
    List<Double> ultimosServicios(int colaId, int n);

    /** RN-M2-04: ventanillas con un llamado desde {@code desde} o con un turno LLAMADO ahora. */
    int ventanillasConActividad(int colaId, Instant desde);

    int ventanillasActivasAsignadas(int colaId);

    Optional<ModeloGuardado> modeloActivo(int colaId);

    void actualizarParametros(int modeloId, Estado estado);

    Optional<TurnoDatos> turno(int turnoId);

    /** Guarda la predicción mostrada al emitir (una por turno; si ya existe no la cambia). */
    void registrarPrediccion(int turnoId, int colaId, Tipo tipo, int version, int delante, int c, int predSeg, int loSeg, int hiSeg);

    Optional<LogPrediccion> log(int turnoId);

    void completarReal(int turnoId, int realSeg);

    List<Muestra> muestras(int colaId, LocalDate desde);

    int ultimaVersion(int colaId);

    /** Desactiva el modelo vigente, guarda los tres de la nueva versión y activa el elegido (una transacción). */
    void guardarEntrenamiento(int localId, int colaId, int version, List<NuevoModelo> modelos, Tipo elegido);

    List<ModeloFila> modelosDeVersion(int colaId, int version);

    Optional<ModeloFila> activo(int colaId);

    List<LogPrediccion> serie(int colaId, Instant desde, int limite);

    /** Modelos activos que no son BASELINE ni están marcados con deriva. */
    List<ModeloFila> activosVigilables();

    /** Pasa la cola a BASELINE de la misma versión y marca la deriva en el modelo. */
    void volverABase(ModeloFila modelo);

    /** Turnos en espera que pidieron "avisarme X min antes" y aún no se les avisó. */
    List<AvisoPendiente> avisosPendientes(int limite);

    int posicion(int turnoId);

    /** @return {@code true} si este proceso marcó el aviso (no se había enviado). */
    boolean marcarAvisoEnviado(int turnoId, Instant ahora);

    Optional<TurnoToken> turnoPorToken(String token);

    void configurarAviso(int turnoId, Integer minAntes);

    /** Pares (emitido, llamado) de la cola desde {@code desde}, para "mejores horas". */
    List<Espera> esperas(int colaId, Instant desde);

    record Config(String modelo, double alfaEma, double nivelConfianza, int diasEntrenamiento) {
    }

    record ColaInfo(int id, int localId, int tiempoAtencionBase, boolean activa) {
    }

    record ModeloGuardado(int id, int version, Estado estado) {
    }

    record TurnoDatos(int id, int localId, int colaId, Instant emitidoAt, Instant llamadoAt, Instant finalizadoAt, Integer delanteEmision) {
    }

    record LogPrediccion(Instant creado, Tipo tipo, int delante, int c, int predSeg, int loSeg, int hiSeg, Integer realSeg) {
    }

    record Muestra(int id, Instant emitidoAt, Instant llamadoAt, Instant finalizadoAt, boolean atendido, Integer delante, Integer c) {
    }

    record NuevoModelo(Tipo tipo, Estado parametros, ModelosEspera.Metricas metricas, List<Importancia> importancia) {
    }

    record ModeloFila(int id, int localId, int colaId, Tipo tipo, int version, int nMuestras, Double mae, Double medae, Double acierto5,
                      Double sesgo, Double cobertura, Double anchoMedio, List<Importancia> importancia, boolean activo, boolean deriva,
                      Instant entrenadoAt) {
    }

    record AvisoPendiente(int turnoId, int localId, int colaId, int minAntes) {
    }

    record TurnoToken(int id, int localId, String estado) {
    }

    record Espera(Instant emitidoAt, Instant llamadoAt) {
    }
}
