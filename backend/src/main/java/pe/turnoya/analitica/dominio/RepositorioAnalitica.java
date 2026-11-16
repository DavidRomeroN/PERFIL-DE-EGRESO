package pe.turnoya.analitica.dominio;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Puerto de salida de M7: lecturas de analítica sobre {@code turno}, {@code valoracion} y {@code mv_turno_franja};
 * {@code sla_cola}; y el motor de alertas ({@code regla_alerta}, {@code alerta}, {@code alerta_racha},
 * {@code alerta_notificacion}). Las columnas JSON viajan como texto.
 */
public interface RepositorioAnalitica {

    // --- Analítica ---

    enum Agrupar { COLA, HORA, DIA }

    record FilaPercentil(String grupo, int n, Double p50, Double p90, Double p95, Double a50, Double a90, Double a95) {
    }

    List<FilaPercentil> percentiles(int localId, LocalDate desde, LocalDate hasta, Integer colaId, Agrupar agrupar, String zona);

    record CeldaCalor(int dow, int hora, int llegadas, int abandonos, Double p90, int n) {
    }

    List<CeldaCalor> mapaDeCalor(int localId, LocalDate desde, LocalDate hasta, Integer colaId, String zona);

    record ColaSla(int colaId, String cola, Integer esperaMaxMin, Double objetivoPct, Integer ventanaMin, boolean activo) {

        public boolean configurado() {
            return esperaMaxMin != null && activo;
        }
    }

    List<ColaSla> colasConSla(int localId);

    Optional<ColaSla> colaConSla(int colaId, int localId);

    void guardarSla(int colaId, int esperaMaxMin, double objetivoPct, int ventanaMin, boolean activo);

    record TiemposTurno(String estado, Instant emitidoAt, Instant llamadoAt, Instant finalizadoAt) {
    }

    List<TiemposTurno> turnosDesde(int colaId, Instant desde);

    record PuntoSerie(Instant hora, int cumplen, int total) {
    }

    List<PuntoSerie> serieSla(int colaId, int maxSeg, Instant desde);

    record FilaValoracion(int estrellas, String comentario, Instant createdAt, Instant emitidoAt, Instant llamadoAt) {
    }

    List<FilaValoracion> valoraciones(int localId, LocalDate desde, LocalDate hasta);

    Map<String, Integer> conteoPorEstado(int localId, LocalDate desde, LocalDate hasta, Integer colaId);

    void refrescarVista();

    // --- Mediciones para las alertas ---

    record ColaBreve(int id, String nombre) {
    }

    List<ColaBreve> colasActivas(int localId, Integer colaId);

    Optional<Instant> masAntiguoEnEspera(int colaId, LocalDate fecha);

    int enEspera(int colaId, LocalDate fecha);

    int enEsperaDelLocal(int localId, LocalDate fecha, Integer colaId);

    List<Integer> llegadasHistoricas(int colaId, int dow, int franja, LocalDate desde, LocalDate hasta);

    int llegadasDesde(int colaId, Instant desde);

    record VentanillaBreve(int id, String nombre, Integer colaId) {
    }

    List<VentanillaBreve> ventanillasActivas(int localId);

    record UltimoUso(Instant llamadoAt, String estado) {
    }

    Optional<UltimoUso> ultimoUso(int ventanillaId, LocalDate fecha);

    List<String> ultimosEstadosWhatsapp(int localId, int n);

    record KioscoBreve(int id, int numero, String nombre, Instant ultimoHeartbeatAt) {
    }

    List<KioscoBreve> kioscosEmparejados(int localId);

    // --- Reglas de alerta ---

    record ReglaAlerta(int id, int localId, String tipo, String nombre, String umbralJson, String nivelesJson, int resolverTrasMin, Instant silenciadaHasta,
                       boolean activa) {
    }

    int contarReglas(int localId);

    void crearRegla(int localId, String tipo, String nombre, String umbralJson, String nivelesJson, int resolverTrasMin);

    List<ReglaAlerta> reglas(int localId);

    Optional<ReglaAlerta> regla(int id, int localId);

    void actualizarRegla(int id, String nombre, String umbralJson, String nivelesJson, int resolverTrasMin, boolean activa, Instant silenciadaHasta);

    boolean eliminarRegla(int id, int localId);

    // --- Alertas ---

    record Alerta(long id, int localId, Integer reglaId, String tipo, String huella, String entidad, int nivel, String estado, String titulo, String detalleJson,
                  int ocurrencias, Instant primeraVezAt, Instant ultimaVezAt, Instant proximoEscalaAt, Integer reconocidaPor, Instant reconocidaAt,
                  Instant resueltaAt, Instant silenciadaHasta) {
    }

    record Racha(int disparos, Instant normalDesde) {
    }

    Optional<Racha> racha(String huella);

    void guardarRacha(String huella, int localId, int disparos, Instant normalDesde, Instant ahora);

    Optional<Alerta> alertaViva(String huella);

    Optional<Alerta> ultimaResuelta(String huella);

    /** Vacío si otra instancia ya abrió la alerta viva con esa huella (índice único parcial, RN-M7-02). */
    Optional<Long> abrir(int localId, Integer reglaId, String tipo, String huella, String entidad, String titulo, String detalleJson, Instant ahora,
                         Instant proximoEscala);

    void reabrir(long id, Instant ahora, String detalleJson, Instant proximoEscala);

    void repetir(long id, Instant ahora, String detalleJson);

    void escalar(long id, int nivel, Instant proximoEscala, Instant ahora);

    void desilenciar(long id, Instant ahora);

    void resolver(long id, Instant ahora);

    void reconocer(long id, Integer usuarioId, Instant ahora);

    void silenciar(long id, Instant hasta);

    void reabrirManual(long id, Instant ahora);

    Optional<Alerta> alerta(long id, int localId);

    List<Alerta> alertas(int localId, List<String> estados, String tipo, Long cursor, int limite);

    int contarAbiertas(int localId);

    /** Alertas de sistema (por evento) vivas que no se repiten desde {@code limite}: se resuelven solas. */
    List<Alerta> deSistemaSinRepetir(int localId, Instant limite);

    /** ≤ 1 notificación por (alerta, nivel, canal, hora) (RN-M7-05). Falso si ya existía. */
    boolean registrarNotificacion(long alertaId, int nivel, String canal, Instant hora);

    void actualizarNotificacion(long alertaId, int nivel, String canal, Instant hora, String estado, String destino);

    List<Integer> localesActivos();

    boolean candado(int localId);

    int borrarResueltasAntes(Instant limite);
}
