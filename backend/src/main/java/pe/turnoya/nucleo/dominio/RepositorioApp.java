package pe.turnoya.nucleo.dominio;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Puerto de salida de la app móvil del cliente: códigos de verificación, sesiones, dispositivo de cada turno e
 * historial del cliente. Lo implementa {@code infraestructura.AppJdbc}.
 */
public interface RepositorioApp {

    // --- Código de verificación del celular ---

    Optional<CodigoPendiente> codigo(String telefonoHash);

    /** Reemplaza el código vigente del celular (uno a la vez) y reinicia los intentos. */
    void guardarCodigo(String telefonoHash, String codigoHash, Instant expira, Instant ahora);

    void sumarIntento(String telefonoHash);

    void borrarCodigo(String telefonoHash);

    int borrarCodigosVencidos(Instant antes);

    // --- Sesiones ---

    void crearSesion(String tokenHash, int clienteId, String dispositivoHash, Instant ahora);

    /** Cliente de una sesión vigente; anota el uso. */
    Optional<Integer> clienteDeSesion(String tokenHash, Instant ahora);

    void revocarSesion(String tokenHash, Instant ahora);

    // --- Dispositivo del turno ---

    /** Serializa las emisiones del mismo dispositivo dentro de la transacción en curso. */
    void bloquearDispositivo(String dispositivoHash);

    Optional<TurnoActivo> activoDeDispositivo(int colaId, String dispositivoHash);

    void registrarTurno(int turnoId, String dispositivoHash, Instant ahora);

    // --- Antifraude ---

    /**
     * Fechas de los turnos a los que no se presentó, del dispositivo o del cliente (cualquier canal), desde
     * {@code desde}; la más reciente primero y como mucho {@code limite}.
     */
    List<Falta> faltas(String dispositivoHash, Integer clienteId, Instant desde, int limite);

    /** Turnos activos (en espera o llamados) del dispositivo o del cliente en todos los locales, emitidos desde {@code desde}. */
    int activos(String dispositivoHash, Integer clienteId, Instant desde);

    Optional<Integer> idDeTurno(String token);

    // --- Cuenta con correo ---

    /** Cliente sin teléfono (se registró con correo). */
    int crearCliente(String nombre, Instant ahora);

    void crearCuenta(int clienteId, String correo, String claveHash, Instant ahora);

    Optional<CuentaCorreo> cuentaPorCorreo(String correo);

    void anotarFallo(int clienteId, int intentos, Instant bloqueadaHasta);

    void anotarIngreso(int clienteId, Instant ahora);

    Optional<DatosCliente> datosCliente(int clienteId);

    // --- Historial ---

    List<TurnoDeCliente> turnosDeCliente(int clienteId, int limite);

    record CodigoPendiente(String codigoHash, int intentos, Instant expira, Instant creado) {
    }

    record TurnoActivo(String codigo, String token) {
    }

    /** Turno al que el cliente no se presentó. */
    record Falta(Instant fecha, String codigo, String cola, String local) {
    }

    record CuentaCorreo(int clienteId, String correo, String claveHash, int intentosFallidos, Instant bloqueadaHasta) {
    }

    /** Lo que la app muestra en el perfil; el teléfono viene cifrado (nulo si la cuenta es solo de correo). */
    record DatosCliente(String nombre, String correo, String telefonoCifrado, Instant creado) {
    }

    record TurnoDeCliente(String token, String codigo, String estado, String canal, Instant emitidoAt, String cola, String local, String localSlug) {
    }
}
