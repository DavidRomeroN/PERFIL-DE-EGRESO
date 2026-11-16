package pe.turnoya.citas.checkin;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import org.springframework.stereotype.Service;
import pe.turnoya.citas.dominio.ReglasCitas;
import pe.turnoya.citas.dominio.ReglasCitas.EstadoCita;
import pe.turnoya.citas.dominio.ReglasCitas.TipoVentana;
import pe.turnoya.citas.dominio.RepositorioCitas;
import pe.turnoya.citas.dominio.RepositorioCitas.Cita;
import pe.turnoya.citas.reserva.ReservaCitas;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.nucleo.TomaDeTurnos;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;

/**
 * §6.5 Check-in: dentro de la ventana (−10/+15 min por defecto) la cita se vuelve un turno con prioridad CITA; tarde
 * (dentro de la gracia) entra como turno general. Desde el celular exige el PIN de presencia que muestra la pantalla.
 */
@Service
public class CheckinCitas {

    private final RepositorioCitas repositorio;
    private final ReservaCitas reservas;
    private final TomaDeTurnos tomaDeTurnos;
    private final CatalogoLocales locales;
    private final ModulosLocal modulos;
    private final LimitadorPeticiones limitador;
    private final PropiedadesTurnoYa propiedades;
    private final Clock reloj;

    CheckinCitas(RepositorioCitas repositorio, ReservaCitas reservas, TomaDeTurnos tomaDeTurnos, CatalogoLocales locales, ModulosLocal modulos,
                 LimitadorPeticiones limitador, PropiedadesTurnoYa propiedades, Clock reloj) {
        this.repositorio = repositorio;
        this.reservas = reservas;
        this.tomaDeTurnos = tomaDeTurnos;
        this.locales = locales;
        this.modulos = modulos;
        this.limitador = limitador;
        this.propiedades = propiedades;
        this.reloj = reloj;
    }

    public record Resultado(String turnoToken, String codigo, boolean tarde, boolean repetido) {
    }

    public Resultado checkin(String token, String pin, boolean presencial, String actor) {
        Cita c = reservas.exigirPorToken(token);
        modulos.exigir(c.localId(), Modulo.M3);
        if (c.estado() == EstadoCita.CHECKIN && c.turnoId() != null) {
            var t = repositorio.turno(c.turnoId());
            if (t.isPresent()) {
                return new Resultado(t.get().token(), t.get().codigo(), c.tarde(), true);
            }
        }
        if (!ReglasCitas.ACTIVAS.contains(c.estado())) {
            throw ErrorNegocio.conflicto("M3_ESTADO_INVALIDO", "La cita no admite check-in");
        }
        var cfg = repositorio.config(c.colaId());
        Instant ahora = reloj.instant();
        var v = ReglasCitas.ventanaCheckin(c.inicio(), ahora, cfg.checkinAntesMin(), cfg.checkinDespuesMin(), cfg.graciaNoShowMin());
        if (v.tipo() == TipoVentana.TEMPRANO) {
            String hora = ReglasCitasHora.formato(v.disponibleDesde(), locales.exigir(c.localId()).zonaHoraria());
            throw new ErrorNegocio("M3_CHECKIN_MUY_TEMPRANO", "El check-in está disponible desde las " + hora, 409,
                    Map.of("disponibleDesde", v.disponibleDesde().toString()));
        }
        if (v.tipo() == TipoVentana.VENCIDA) {
            throw ErrorNegocio.conflicto("M3_CITA_VENCIDA", "La cita venció; acércate al mostrador");
        }
        if (!presencial) {
            if (pin == null || pin.isBlank()) {
                throw ErrorNegocio.prohibido("M3_PIN_INVALIDO", "Ingresa el PIN que aparece en la pantalla del local");
            }
            // 5 intentos fallidos de PIN ⇒ bloqueo de 5 min por cita
            String clave = "pin:" + c.id();
            if (limitador.contador(clave, Duration.ofMinutes(5)) >= 5) {
                throw new ErrorNegocio("RATE_LIMIT", "Demasiados intentos; espera 5 minutos", 429);
            }
            if (!ReglasCitas.validarPin(secreto(c.localId()), c.localId(), pin, ahora.toEpochMilli())) {
                limitador.incrementar(clave, Duration.ofMinutes(5));
                throw ErrorNegocio.prohibido("M3_PIN_INVALIDO", "El PIN no coincide con el de la pantalla");
            }
        }
        boolean tarde = v.tipo() == TipoVentana.TARDE;
        var turno = tomaDeTurnos.porCita(c.colaId(), c.clienteId(), !tarde, ReglasCitas.emisionDeCita(c.inicio(), ahora, tarde), c.id());
        repositorio.marcarCheckin(c.id(), turno.id(), ahora, tarde);
        reservas.evento(c.id(), "CHECKIN", Map.of("tarde", tarde, "presencial", presencial), actor == null ? "cliente" : actor);
        reservas.anunciar(c.localId(), c.id(), c.token(), "CHECKIN");
        return new Resultado(turno.token(), turno.codigo(), tarde, false);
    }

    /** Check-in por el código corto (kiosco M5): estar frente al kiosco ya prueba presencia. */
    public Resultado checkinPorCodigo(int localId, String codigo) {
        Cita c = repositorio.citaPorCodigo(localId, codigo == null ? "" : codigo.trim().toUpperCase())
                .orElseThrow(() -> ErrorNegocio.noEncontrado("M3_CITA_NO_ENCONTRADA", "No encontramos una cita con ese código"));
        return checkin(c.token(), null, true, "kiosco");
    }

    public record Pin(String pin, int segundosRestantes) {
    }

    /** PIN vigente para la TV, el panel y el kiosco. */
    public Pin pinActual(int localId) {
        long ahora = reloj.millis();
        return new Pin(ReglasCitas.pinPresencia(secreto(localId), localId, ReglasCitas.ventanaPin(ahora)), ReglasCitas.segundosRestantesPin(ahora));
    }

    /** Secreto del PIN por local, derivado de la clave de cifrado (no se guarda en la BD; igual que el sistema anterior). */
    private String secreto(int localId) {
        String clave = propiedades.seguridad().dataEncryptionKey();
        try {
            byte[] h = MessageDigest.getInstance("SHA-256")
                    .digest(("pin-presencia:" + localId + ":" + (clave == null || clave.isBlank() ? "dev" : clave)).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(h);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Formato de hora local para los mensajes. */
    static final class ReglasCitasHora {
        private ReglasCitasHora() {
        }

        static String formato(Instant instante, java.time.ZoneId zona) {
            return pe.turnoya.citas.agenda.DisponibilidadCitas.HORA.format(instante.atZone(zona));
        }
    }
}
