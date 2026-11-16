package pe.turnoya.kiosco.dominio;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** Puerto de salida de M5: dispositivos, eventos sincronizados y lecturas que necesita el kiosco. */
public interface RepositorioKiosco {

    // --- Dispositivos ---

    int contarActivos(int localId);

    int siguienteNumero(int localId);

    int crear(int localId, int numero, String nombre, List<Integer> colaIds, String pinHash);

    Optional<Dispositivo> dispositivo(int id);

    Optional<Dispositivo> dispositivoDelLocal(int localId, int id);

    List<Dispositivo> dispositivos(int localId);

    Optional<Dispositivo> porToken(String tokenHash);

    List<Dispositivo> conCodigoVigente();

    void guardarCodigo(int id, String codigoHash, Instant expira);

    /** Cambia los campos no nulos y sube la versión de la configuración. Desactivar borra el token. */
    void editar(int id, String nombre, List<Integer> colaIds, Boolean activo, String pinHash);

    void revocarToken(int id);

    void emparejar(int id, String tokenHash, Instant ahora);

    /** @return {@code true} si antes estaba sin conexión. */
    boolean latido(int id, Instant ahora, int pendientes, String version, String impresora, Integer offsetMs);

    List<Dispositivo> sinLatidoDesde(Instant limite);

    void marcarSinConexion(int id);

    int colasDelLocal(int localId, List<Integer> colaIds);

    // --- Eventos ---

    /** @return {@code false} si la clave ya existía (evento repetido). */
    boolean insertarEvento(int dispositivoId, String claveIdem, int seq, String tipo, String payloadJson, Instant tsDispositivo, int offsetMs);

    Optional<Evento> evento(String claveIdem);

    Optional<Evento> eventoDelLocal(int localId, long id);

    Optional<Instant> ultimoTsCorregido(int dispositivoId, long exceptoEventoId);

    void marcarEvento(long id, String estado, String motivo, Integer turnoId, Instant tsCorregido, String payloadJson);

    void resolverEvento(long id, String estado, Integer turnoId, int usuarioId, Instant ahora, String payloadJson);

    List<EventoListado> eventos(int localId, String estado, Integer dispositivoId, Long cursor, int limite);

    List<Evento> eventosPorSeq(int dispositivoId, int seq);

    int borrarEventosAntiguos(Instant antesDe);

    Optional<TurnoBreve> turno(int turnoId);

    Optional<TurnoBreve> turnoPorToken(String token);

    record Dispositivo(int id, int localId, int numero, String nombre, List<Integer> colaIds, String tokenHash, String codigoHash,
                       Instant codigoExpira, String pinHash, boolean activo, String versionApp, Instant ultimoHeartbeatAt, int offsetRelojMs,
                       int pendientes, String impresora, int configVersion, boolean enLinea) {
    }

    record Evento(long id, int dispositivoId, String claveIdem, int seq, String tipo, String payloadJson, Instant tsDispositivo, int offsetMs,
                  Instant tsCorregido, String estado, String motivo, Integer turnoId) {
    }

    record EventoListado(long id, int numero, String dispositivo, int seq, String tipo, String estado, String motivo, Instant tsDispositivo,
                         Instant tsCorregido, Instant recibidoAt, Integer turnoId, Integer colaId) {
    }

    record TurnoBreve(int id, String codigo, String token) {
    }
}
