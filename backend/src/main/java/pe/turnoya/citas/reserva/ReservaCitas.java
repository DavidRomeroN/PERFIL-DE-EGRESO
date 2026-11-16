package pe.turnoya.citas.reserva;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import pe.turnoya.citas.agenda.DisponibilidadCitas;
import pe.turnoya.citas.dominio.ReglasCitas;
import pe.turnoya.citas.dominio.ReglasCitas.EstadoCita;
import pe.turnoya.citas.dominio.RepositorioCitas;
import pe.turnoya.citas.dominio.RepositorioCitas.Cita;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.eventos.EventoPantalla;
import pe.turnoya.compartido.seguridad.CifradoDatos;
import pe.turnoya.compartido.seguridad.Tokens;
import pe.turnoya.notificaciones.AvisosAlCliente;
import pe.turnoya.nucleo.TomaDeTurnos;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import tools.jackson.databind.ObjectMapper;

/** M3 · Reservar, ver, confirmar, cancelar y reprogramar una cita (docs/modulos/M3-citas-reservas.md §6.2–6.3). */
@Service
public class ReservaCitas {

    private static final Logger log = LoggerFactory.getLogger(ReservaCitas.class);
    public static final DateTimeFormatter FECHA_LARGA = DateTimeFormatter.ofPattern("EEEE, d 'de' MMMM, HH:mm", Locale.forLanguageTag("es-PE"));

    private final RepositorioCitas repositorio;
    private final DisponibilidadCitas disponibilidad;
    private final TomaDeTurnos tomaDeTurnos;
    private final CatalogoLocales locales;
    private final ModulosLocal modulos;
    private final AvisosAlCliente avisos;
    private final CifradoDatos cifrado;
    private final PropiedadesTurnoYa propiedades;
    private final ApplicationEventPublisher eventos;
    private final ObjectMapper json;
    private final Clock reloj;

    ReservaCitas(RepositorioCitas repositorio, DisponibilidadCitas disponibilidad, TomaDeTurnos tomaDeTurnos, CatalogoLocales locales, ModulosLocal modulos,
                 AvisosAlCliente avisos, CifradoDatos cifrado, PropiedadesTurnoYa propiedades, ApplicationEventPublisher eventos, ObjectMapper json, Clock reloj) {
        this.repositorio = repositorio;
        this.disponibilidad = disponibilidad;
        this.tomaDeTurnos = tomaDeTurnos;
        this.locales = locales;
        this.modulos = modulos;
        this.avisos = avisos;
        this.cifrado = cifrado;
        this.propiedades = propiedades;
        this.eventos = eventos;
        this.json = json;
        this.reloj = reloj;
    }

    /** {@code clienteId} ya conocido (bot, admin) o {@code null} para resolverlo con nombre y celular. */
    public record Solicitud(int colaId, int slotId, String nombre, String telefono, boolean consentimiento, String canal, Integer clienteId) {
    }

    public VistaCita reservarPublica(String slug, Solicitud s) {
        return reservar(disponibilidad.localPublico(slug), s);
    }

    public VistaCita reservarEnLocal(int localId, Solicitud s) {
        Local local = locales.exigir(localId);
        modulos.exigir(localId, Modulo.M3);
        return reservar(local, s);
    }

    private VistaCita reservar(Local local, Solicitud s) {
        Instant ahora = reloj.instant();
        var cc = disponibilidad.colaConCitas(local.id(), s.colaId());
        var cfg = cc.config();
        Integer clienteId = s.clienteId() != null ? s.clienteId() : tomaDeTurnos.cliente(s.nombre(), s.telefono(), s.consentimiento());
        if (clienteId == null) {
            throw new ErrorNegocio("VALIDACION", "Indica tu nombre", 422);
        }
        // RN-M3-01/06: bloqueo por reincidencia y límite de citas futuras
        Optional<Instant> bloqueo = repositorio.bloqueoVigente(local.id(), clienteId, ahora);
        if (bloqueo.isPresent()) {
            String hasta = DateTimeFormatter.ofPattern("d/M/yyyy").format(bloqueo.get().atZone(local.zonaHoraria()));
            throw new ErrorNegocio("M3_CLIENTE_BLOQUEADO", "Reservas bloqueadas hasta " + hasta + " por inasistencias", 403,
                    Map.of("hasta", bloqueo.get().toString()));
        }
        if (repositorio.citasFuturasActivas(clienteId, ahora) >= 3) {
            throw ErrorNegocio.conflicto("M3_LIMITE_CITAS", "Ya tienes 3 citas futuras activas");
        }
        Instant minInicio = ahora.plus(Duration.ofMinutes(cfg.anticipacionMinMin()));
        Instant maxInicio = ahora.plus(Duration.ofDays(cfg.anticipacionMaxDias()));
        String canal = s.canal() == null ? "WEB" : s.canal();

        for (int intento = 0; intento < 3; intento++) {
            String token = Tokens.generar(10);
            String codigo = Tokens.generar(6);
            Optional<Integer> id;
            try {
                id = repositorio.reservar(local.id(), s.colaId(), s.slotId(), clienteId, local.zonaHoraria().getId(), token, codigo, canal, minInicio, maxInicio);
            } catch (DuplicateKeyException e) {
                String msg = String.valueOf(e.getMessage());
                if (msg.contains("ux_cita_activa")) {
                    throw ErrorNegocio.conflicto("M3_CITA_DUPLICADA", "Ya tienes una cita activa ese día en este servicio");
                }
                if (msg.contains("cita_codigo_checkin_key") || msg.contains("cita_token_key")) {
                    continue;
                }
                throw e;
            }
            if (id.isEmpty()) {
                var slot = repositorio.slot(s.slotId(), s.colaId())
                        .orElseThrow(() -> ErrorNegocio.noEncontrado("M3_SLOT_LLENO", "Ese horario no existe"));
                if (!slot.inicio().isAfter(ahora)) {
                    throw ErrorNegocio.conflicto("M3_SLOT_PASADO", "Ese horario ya pasó");
                }
                if (slot.inicio().isBefore(minInicio) || slot.inicio().isAfter(maxInicio)) {
                    throw new ErrorNegocio("M3_FUERA_DE_ANTICIPACION", "Reserva con al menos " + cfg.anticipacionMinMin() + " min y hasta "
                            + cfg.anticipacionMaxDias() + " días de anticipación", 422);
                }
                throw ErrorNegocio.conflicto("M3_SLOT_LLENO", "Ese horario ya no tiene cupo");
            }
            int citaId = id.get();
            evento(citaId, "RESERVADA", Map.of("canal", canal), null);
            notificar(citaId, "confirmada");
            anunciar(local.id(), citaId, token, "RESERVADA");
            return vista(repositorio.cita(citaId).orElseThrow(), local);
        }
        throw new ErrorNegocio("ERROR_INTERNO", "No se pudo registrar la cita", 500);
    }

    // --- Lectura ---

    public record ColaResumen(int id, String nombre) {
    }

    public record LocalResumen(String slug, String nombreComercial, String direccion) {
    }

    public record TurnoResumen(String token, String codigo, String estado) {
    }

    public record Checkin(String ventana, Instant disponibleDesde, int antesMin, int despuesMin) {
    }

    /** Sin datos personales: solo lo que muestra el enlace de la cita. */
    public record VistaCita(int id, String token, String codigoCheckin, EstadoCita estado, Instant inicio, Instant fin, String inicioLocal, boolean tarde,
                            ColaResumen cola, LocalResumen local, String urlQr, TurnoResumen turno, Checkin checkin, Boolean puedeCancelar) {
    }

    VistaCita vista(Cita c, Local local) {
        String colaNombre = repositorio.cola(c.localId(), c.colaId()).map(RepositorioCitas.ColaCitas::nombre).orElse("");
        return new VistaCita(c.id(), c.token(), c.codigoCheckin(), c.estado(), c.inicio(), c.fin(), FECHA_LARGA.format(c.inicio().atZone(local.zonaHoraria())),
                c.tarde(), new ColaResumen(c.colaId(), colaNombre), new LocalResumen(local.slug(), local.nombreComercial(), local.direccion()),
                urlCita(c.token()), null, null, null);
    }

    /** GET /public/citas/:token — con la ventana de check-in y si aún se puede cancelar. */
    public VistaCita obtener(String token) {
        Cita c = exigirPorToken(token);
        Local local = locales.exigir(c.localId());
        var cfg = repositorio.config(c.colaId());
        Instant ahora = reloj.instant();
        var v = ReglasCitas.ventanaCheckin(c.inicio(), ahora, cfg.checkinAntesMin(), cfg.checkinDespuesMin(), cfg.graciaNoShowMin());
        TurnoResumen turno = c.turnoId() == null ? null
                : repositorio.turno(c.turnoId()).map(t -> new TurnoResumen(t.token(), t.codigo(), t.estado())).orElse(null);
        VistaCita base = vista(c, local);
        return new VistaCita(base.id(), base.token(), base.codigoCheckin(), base.estado(), base.inicio(), base.fin(), base.inicioLocal(), base.tarde(),
                base.cola(), base.local(), base.urlQr(), turno,
                new Checkin(v.tipo().name(), v.disponibleDesde(), cfg.checkinAntesMin(), cfg.checkinDespuesMin()),
                ReglasCitas.ACTIVAS.contains(c.estado()) && c.inicio().isAfter(ahora));
    }

    public Cita exigirPorToken(String token) {
        return repositorio.citaPorToken(token).orElseThrow(() -> ErrorNegocio.noEncontrado("M3_CITA_NO_ENCONTRADA", "La cita no existe"));
    }

    // --- Cambios de estado ---

    public VistaCita confirmar(String token) {
        Cita c = exigirPorToken(token);
        if (!repositorio.cambiarEstado(c.id(), java.util.Set.of(EstadoCita.RESERVADA), EstadoCita.CONFIRMADA, reloj.instant())) {
            if (c.estado() == EstadoCita.CONFIRMADA) {
                return obtener(token);
            }
            throw ErrorNegocio.conflicto("M3_ESTADO_INVALIDO", "La cita ya no se puede confirmar");
        }
        evento(c.id(), "CONFIRMADA", null, null);
        anunciar(c.localId(), c.id(), token, "CONFIRMADA");
        return obtener(token);
    }

    /** §6.3: cancelar devuelve el cupo en la misma transacción. */
    public Cita cancelar(int citaId, String motivo, String actor) {
        if (!repositorio.cancelar(citaId, motivo, reloj.instant())) {
            throw ErrorNegocio.conflicto("M3_ESTADO_INVALIDO", "La cita ya no se puede cancelar");
        }
        Cita c = repositorio.cita(citaId).orElseThrow();
        evento(citaId, "CANCELADA", Map.of("motivo", motivo), actor);
        anunciar(c.localId(), c.id(), c.token(), "CANCELADA");
        return c;
    }

    public VistaCita cancelarPorToken(String token) {
        Cita c = exigirPorToken(token);
        if (!c.inicio().isAfter(reloj.instant())) {
            throw ErrorNegocio.conflicto("M3_ESTADO_INVALIDO", "La cita ya empezó; no se puede cancelar en línea");
        }
        cancelar(c.id(), "Cancelada por el cliente", "cliente");
        return obtener(token);
    }

    /** §6.3: reprogramar es atómico; si el nuevo slot está lleno la cita original queda intacta. El admin no respeta la anticipación. */
    public Cita reprogramar(int citaId, int nuevoSlotId, String actor, boolean porAdmin) {
        Cita c = repositorio.cita(citaId).orElseThrow(() -> ErrorNegocio.noEncontrado("M3_CITA_NO_ENCONTRADA", "La cita no existe"));
        if (!ReglasCitas.ACTIVAS.contains(c.estado())) {
            throw ErrorNegocio.conflicto("M3_ESTADO_INVALIDO", "La cita ya no se puede cambiar");
        }
        if (nuevoSlotId == c.slotId()) {
            return c;
        }
        Local local = locales.exigir(c.localId());
        var cfg = repositorio.config(c.colaId());
        Instant ahora = reloj.instant();
        Instant minInicio = porAdmin ? ahora : ahora.plus(Duration.ofMinutes(cfg.anticipacionMinMin()));
        Instant maxInicio = porAdmin ? ahora.plus(Duration.ofDays(366)) : ahora.plus(Duration.ofDays(cfg.anticipacionMaxDias()));
        boolean ok;
        try {
            ok = repositorio.reprogramar(c, nuevoSlotId, minInicio, maxInicio, local.zonaHoraria().getId());
        } catch (DuplicateKeyException e) {
            if (String.valueOf(e.getMessage()).contains("ux_cita_activa")) {
                throw ErrorNegocio.conflicto("M3_CITA_DUPLICADA", "Ya tienes otra cita ese día en este servicio");
            }
            throw e;
        }
        if (!ok) {
            throw ErrorNegocio.conflicto("M3_SLOT_LLENO", "Ese horario ya no tiene cupo; tu cita se mantiene");
        }
        repositorio.borrarRecordatorios(c.id());
        evento(c.id(), "REPROGRAMADA", Map.of("de", c.slotId(), "a", nuevoSlotId), actor);
        anunciar(c.localId(), c.id(), c.token(), "RESERVADA");
        return repositorio.cita(c.id()).orElseThrow();
    }

    public VistaCita reprogramarPorToken(String token, int slotId) {
        Cita c = exigirPorToken(token);
        reprogramar(c.id(), slotId, "cliente", false);
        return obtener(token);
    }

    // --- .ics y notificaciones ---

    public String ics(String token) {
        Cita c = exigirPorToken(token);
        Local local = locales.exigir(c.localId());
        String servicio = repositorio.cola(c.localId(), c.colaId()).map(RepositorioCitas.ColaCitas::nombre).orElse("");
        return ReglasCitas.generarIcs(new ReglasCitas.DatosIcs(c.id(), c.inicio(), c.fin(), local.nombreComercial(), servicio, local.direccion(),
                urlCita(c.token()), local.zonaHoraria()), reloj.instant());
    }

    /** Confirmación de la reserva y recordatorios T−24 h / T−2 h. Sin celular no se envía nada. */
    public void notificar(int citaId, String tipo) {
        try {
            Cita c = repositorio.cita(citaId).orElse(null);
            if (c == null) {
                return;
            }
            var contacto = repositorio.contacto(c.clienteId()).orElse(null);
            String tel = contacto == null ? null : cifrado.descifrar(contacto.telefonoCifrado()).orElse(null);
            if (tel == null) {
                return;
            }
            Local local = locales.exigir(c.localId());
            ZoneId zona = local.zonaHoraria();
            String servicio = repositorio.cola(c.localId(), c.colaId()).map(RepositorioCitas.ColaCitas::nombre).orElse("");
            String cuando = FECHA_LARGA.format(c.inicio().atZone(zona));
            String url = urlCita(c.token());
            String texto = tipo.equals("confirmada")
                    ? "✅ Reservaste tu cita en *" + local.nombreComercial() + "* (" + servicio + ") para el " + cuando + ". Código de check-in: *"
                    + c.codigoCheckin() + "*. Detalles: " + url
                    : "⏰ Recordatorio: tu cita en *" + local.nombreComercial() + "* (" + servicio + ") es " + (tipo.equals("24h") ? "mañana" : "en 2 horas")
                    + ", " + cuando + ". Confirma o cancela aquí: " + url;
            avisos.deCita(c.localId(), c.id(), tel, tipo.equals("confirmada") ? "cita_confirmada" : "cita_recordatorio", List.of(), texto);
        } catch (RuntimeException e) {
            log.warn("M3: no se envió el aviso '{}' de la cita {}: {}", tipo, citaId, e.getMessage());
        }
    }

    public String urlCita(String token) {
        return propiedades.urlPublica() + "/c/" + token;
    }

    public void evento(int citaId, String tipo, Map<String, Object> datos, String actor) {
        repositorio.evento(citaId, tipo, datos == null ? null : json.writeValueAsString(datos), actor);
    }

    public void anunciar(int localId, int citaId, String token, String estado) {
        eventos.publishEvent(new EventoPantalla("cita:estado", localId, Map.of("cita", Map.of("id", citaId, "token", token, "estado", estado))));
    }
}
