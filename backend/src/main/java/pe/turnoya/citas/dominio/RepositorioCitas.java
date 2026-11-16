package pe.turnoya.citas.dominio;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import pe.turnoya.citas.dominio.ReglasCitas.EstadoCita;
import pe.turnoya.citas.dominio.ReglasCitas.Rango;
import pe.turnoya.citas.dominio.ReglasCitas.Tramo;

/** Puerto de salida de M3: configuración por cola, slots, citas, eventos, recordatorios y bloqueos. */
public interface RepositorioCitas {

    // --- Configuración y colas ---

    /** Configuración de la cola (valores por defecto e inactiva si nunca se guardó). Solo lectura. */
    ConfigCitas config(int colaId);

    void guardarConfig(int colaId, ConfigCitas config);

    int otrasColasConCitas(int localId, int exceptoColaId);

    void pesoCategoriaCita(int localId, int peso);

    Optional<ColaCitas> cola(int localId, int colaId);

    List<ColaCitas> colasDelLocal(int localId);

    List<ConfigActiva> configsActivas();

    // --- Slots ---

    List<Tramo> horarios(int localId, int diaSemana);

    List<Rango> bloqueosAgenda(int localId, int colaId, Instant desde, Instant hasta);

    int insertarSlots(int colaId, List<Rango> franjas, int capacidad);

    List<Slot> slots(int localId, Integer colaId, Instant desde, Instant hasta);

    Optional<Slot> slot(int slotId, int colaId);

    // --- Reserva ---

    Optional<Instant> bloqueoVigente(int localId, int clienteId, Instant ahora);

    int citasFuturasActivas(int clienteId, Instant ahora);

    /**
     * §6.2 Reserva sin sobrecupo en una sola sentencia: toma el cupo del slot (si queda y está dentro de la anticipación)
     * e inserta la cita. Vacío si no hubo cupo. Lanza {@code DuplicateKeyException} si choca un índice único.
     */
    Optional<Integer> reservar(int localId, int colaId, int slotId, int clienteId, String zona, String token, String codigo, String canal,
                               Instant minInicio, Instant maxInicio);

    void evento(int citaId, String tipo, String datosJson, String actor);

    Optional<Cita> cita(int citaId);

    Optional<Cita> citaPorToken(String token);

    Optional<Cita> citaPorCodigo(int localId, String codigo);

    Optional<TurnoDeCita> turno(int turnoId);

    Optional<Contacto> contacto(int clienteId);

    boolean cambiarEstado(int citaId, Set<EstadoCita> desde, EstadoCita hacia, Instant confirmadaAt);

    /** §6.3: cancela y devuelve el cupo en la misma transacción. */
    boolean cancelar(int citaId, String motivo, Instant ahora);

    /** §6.3: mueve la cita a otro slot de forma atómica. {@code false} si el nuevo slot no tiene cupo (la cita queda igual). */
    boolean reprogramar(Cita cita, int nuevoSlotId, Instant minInicio, Instant maxInicio, String zona);

    void borrarRecordatorios(int citaId);

    void marcarCheckin(int citaId, int turnoId, Instant ahora, boolean tarde);

    void marcarEstado(int citaId, EstadoCita estado);

    int noShowsDesde(int localId, int clienteId, Instant desde);

    /** Inasistencias desde {@code desde} posteriores a la última cita atendida del cliente en el local. */
    int faltasSeguidas(int localId, int clienteId, Instant desde);

    boolean hayBloqueoVigente(int localId, int clienteId, Instant ahora);

    void crearBloqueoCliente(int localId, int clienteId, Instant hasta, String motivo);

    // --- Cliente de la app ---

    /** Citas del cliente en todos los locales: primero las próximas, luego las pasadas (más recientes primero). */
    List<CitaDeCliente> citasDeCliente(int clienteId, Instant ahora, int limite);

    /** Sanciones vigentes del cliente (una por local, la que dura más). */
    List<SancionCliente> sancionesVigentes(int clienteId, Instant ahora);

    record CitaDeCliente(int id, String token, EstadoCita estado, Instant inicio, Instant fin, String codigoCheckin, boolean tarde,
                         int localId, String localSlug, String localNombre, String zonaHoraria, String servicio,
                         String turnoToken, String turnoCodigo, String turnoEstado) {
    }

    record SancionCliente(int localId, String localNombre, String zonaHoraria, Instant hasta, String motivo) {
    }

    // --- Jobs ---

    List<CitaParaRecordar> paraRecordar(Instant ahora, Instant hasta);

    /** @return {@code true} si se registró ahora (no se había enviado ese recordatorio). */
    boolean registrarRecordatorio(int citaId, String tipo);

    List<Cita> marcarNoShowVencidas(Instant ahora);

    // --- Administración ---

    List<CitaAgenda> agenda(int localId, LocalDate fecha, Integer colaId);

    List<CitaAgenda> proximas(int localId, Instant desde, Instant hasta, int limite);

    List<BloqueoAgenda> bloqueosAgendaVigentes(int localId, Instant ahora);

    List<BloqueoCliente> bloqueosClienteVigentes(int localId, Instant ahora);

    int crearBloqueoAgenda(int localId, Integer colaId, Instant inicio, Instant fin, String motivo);

    /** RN-M3-09: elimina los slots sin reservas que caen en el bloqueo (nunca los que tienen reservas). */
    int borrarSlotsLibres(int localId, Integer colaId, Instant inicio, Instant fin);

    boolean eliminarBloqueoAgenda(int localId, int id);

    boolean liberarCliente(int localId, int id, int usuarioId);

    // --- Registros ---

    record ConfigCitas(boolean activo, int duracionSlotMin, int cuotaCitasPct, Integer capacidadFija, int anticipacionMinMin, int anticipacionMaxDias,
                       int checkinAntesMin, int checkinDespuesMin, int graciaNoShowMin, int maxNoShow, int bloqueoDias, int pesoCita,
                       List<Integer> recordatoriosMin) {

        public static final ConfigCitas POR_DEFECTO = new ConfigCitas(false, 15, 60, null, 60, 14, 10, 15, 10, 3, 30, 40, List.of(1440, 120));
    }

    record ColaCitas(int id, int localId, String nombre, boolean activa, int ventanillasActivas, boolean conCitas, String descripcion) {
    }

    record ConfigActiva(int colaId, int localId, int anticipacionMaxDias) {
    }

    record Slot(int id, int colaId, String cola, Instant inicio, Instant fin, int capacidad, int reservados) {
    }

    record Cita(int id, int localId, int colaId, int slotId, int clienteId, EstadoCita estado, Instant inicio, Instant fin, String token,
                String codigoCheckin, boolean tarde, Integer turnoId, LocalDate fecha) {
    }

    record TurnoDeCita(String token, String codigo, String estado) {
    }

    record Contacto(String nombre, String telefonoCifrado) {
    }

    record CitaParaRecordar(int id, int localId, Instant inicio, List<Integer> recordatoriosMin) {
    }

    record CitaAgenda(int id, String token, Instant inicio, EstadoCita estado, String canal, int colaId, String cola, String nombre,
                      String telefonoCifrado, String codigoCheckin, String turnoCodigo, String turnoEstado, boolean tarde) {
    }

    record BloqueoAgenda(int id, Integer colaId, String cola, Instant inicio, Instant fin, String motivo) {
    }

    record BloqueoCliente(int id, int clienteId, String nombre, Instant hasta, String motivo) {
    }
}
