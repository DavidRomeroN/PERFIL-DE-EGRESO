package pe.turnoya.citas.administracion;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.citas.agenda.DisponibilidadCitas;
import pe.turnoya.citas.checkin.Inasistencias;
import pe.turnoya.citas.dominio.ReglasCitas.EstadoCita;
import pe.turnoya.citas.dominio.RepositorioCitas;
import pe.turnoya.citas.dominio.RepositorioCitas.Cita;
import pe.turnoya.citas.dominio.RepositorioCitas.ConfigCitas;
import pe.turnoya.citas.reserva.ReservaCitas;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.seguridad.CifradoDatos;
import pe.turnoya.compartido.seguridad.Telefonos;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;

/** Agenda del día, citas próximas, acciones del personal, configuración por servicio y bloqueos (feriados y clientes). */
@Service
public class GestionCitas {

    private final RepositorioCitas repositorio;
    private final ReservaCitas reservas;
    private final Inasistencias inasistencias;
    private final DisponibilidadCitas disponibilidad;
    private final CatalogoLocales locales;
    private final CifradoDatos cifrado;
    private final Auditoria auditoria;
    private final Clock reloj;

    GestionCitas(RepositorioCitas repositorio, ReservaCitas reservas, Inasistencias inasistencias, DisponibilidadCitas disponibilidad, CatalogoLocales locales,
                 CifradoDatos cifrado, Auditoria auditoria, Clock reloj) {
        this.repositorio = repositorio;
        this.reservas = reservas;
        this.inasistencias = inasistencias;
        this.disponibilidad = disponibilidad;
        this.locales = locales;
        this.cifrado = cifrado;
        this.auditoria = auditoria;
        this.reloj = reloj;
    }

    // --- Agenda ---

    public record SlotAgenda(int id, int colaId, String cola, String hora, int capacidad, int reservados) {

        public int porcentaje() {
            return reservados * 100 / Math.max(1, capacidad);
        }
    }

    public record TurnoAgenda(String codigo, String estado) {
    }

    public record ColaNombre(int id, String nombre) {
    }

    public record CitaDelDia(int id, String token, String hora, Instant inicio, EstadoCita estado, String canal, ColaNombre cola, String nombre,
                             String telefono, String codigoCheckin, TurnoAgenda turno, boolean tarde) {

        public boolean activa() {
            return estado == EstadoCita.RESERVADA || estado == EstadoCita.CONFIRMADA;
        }
    }

    public record Agenda(LocalDate fecha, List<SlotAgenda> slots, List<CitaDelDia> citas) {
    }

    public LocalDate hoy(int localId) {
        return Fechas.fechaLocal(locales.exigir(localId).zonaHoraria(), reloj.instant());
    }

    public Agenda agenda(int localId, LocalDate fecha, Integer colaId) {
        Local local = locales.exigir(localId);
        ZoneId zona = local.zonaHoraria();
        Instant desde = Fechas.instanteLocal(fecha, 0, 0, zona);
        var slots = repositorio.slots(localId, colaId, desde, desde.plus(Duration.ofDays(1))).stream()
                .map(s -> new SlotAgenda(s.id(), s.colaId(), s.cola(), DisponibilidadCitas.HORA.format(s.inicio().atZone(zona)), s.capacidad(), s.reservados()))
                .toList();
        var citas = repositorio.agenda(localId, fecha, colaId).stream().map(c -> citaDelDia(c, zona)).toList();
        return new Agenda(fecha, slots, citas);
    }

    public List<CitaDelDia> proximas(int localId, int minutos) {
        Local local = locales.exigir(localId);
        Instant ahora = reloj.instant();
        return repositorio.proximas(localId, ahora.minus(Duration.ofMinutes(15)), ahora.plus(Duration.ofMinutes(minutos)), 20).stream()
                .map(c -> citaDelDia(c, local.zonaHoraria())).toList();
    }

    private CitaDelDia citaDelDia(RepositorioCitas.CitaAgenda c, ZoneId zona) {
        String tel = c.telefonoCifrado() == null ? null : cifrado.descifrar(c.telefonoCifrado()).map(Telefonos::enmascarar).orElse(null);
        return new CitaDelDia(c.id(), c.token(), DisponibilidadCitas.HORA.format(c.inicio().atZone(zona)), c.inicio(), c.estado(), c.canal(),
                new ColaNombre(c.colaId(), c.cola()), c.nombre(), tel, c.codigoCheckin(),
                c.turnoCodigo() == null ? null : new TurnoAgenda(c.turnoCodigo(), c.turnoEstado()), c.tarde());
    }

    // --- Acciones del personal ---

    public enum Accion { CANCELAR, MOVER, NO_SHOW, ASISTIO }

    public Map<String, Object> accion(int localId, int citaId, Accion accion, Integer slotId, String actor) {
        Cita c = repositorio.cita(citaId).filter(x -> x.localId() == localId)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("M3_CITA_NO_ENCONTRADA", "La cita no existe"));
        Cita r = switch (accion) {
            case CANCELAR -> reservas.cancelar(c.id(), "Cancelada por el local", actor);
            case MOVER -> {
                if (slotId == null) {
                    throw new ErrorNegocio("VALIDACION", "Indica el nuevo horario", 422);
                }
                yield reservas.reprogramar(c.id(), slotId, actor, true);
            }
            case NO_SHOW -> {
                if (!repositorio.cambiarEstado(c.id(), Set.of(EstadoCita.RESERVADA, EstadoCita.CONFIRMADA, EstadoCita.CHECKIN), EstadoCita.NO_SHOW, null)) {
                    throw ErrorNegocio.conflicto("M3_ESTADO_INVALIDO", "La cita no se puede marcar");
                }
                reservas.evento(c.id(), "NO_SHOW", Map.of("manual", true), actor);
                inasistencias.aplicarBloqueo(c.localId(), c.clienteId(), c.colaId());
                reservas.anunciar(localId, c.id(), c.token(), "NO_SHOW");
                yield repositorio.cita(c.id()).orElseThrow();
            }
            case ASISTIO -> {
                // Registro manual de asistencia (p. ej. atendida fuera del sistema de turnos)
                if (!Set.of(EstadoCita.RESERVADA, EstadoCita.CONFIRMADA, EstadoCita.CHECKIN).contains(c.estado())
                        || !repositorio.cambiarEstado(c.id(), Set.of(c.estado()), EstadoCita.ATENDIDA, null)) {
                    throw ErrorNegocio.conflicto("M3_ESTADO_INVALIDO", "La cita no se puede marcar como atendida");
                }
                reservas.evento(c.id(), "ATENDIDA", Map.of("manual", true), actor);
                reservas.anunciar(localId, c.id(), c.token(), "ATENDIDA");
                yield repositorio.cita(c.id()).orElseThrow();
            }
        };
        return Map.of("id", r.id(), "estado", r.estado());
    }

    // --- Configuración ---

    public record ConfigDeCola(ColaNombre cola, ConfigCitas config) {
    }

    public List<ConfigDeCola> configuraciones(int localId, Integer colaId) {
        var colas = repositorio.colasDelLocal(localId).stream().filter(c -> colaId == null || c.id() == colaId).toList();
        if (colaId != null && colas.isEmpty()) {
            throw ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe");
        }
        return colas.stream().map(c -> new ConfigDeCola(new ColaNombre(c.id(), c.nombre()), repositorio.config(c.id()))).toList();
    }

    @Transactional
    public ConfigCitas guardarConfig(int localId, int colaId, ConfigCitas d, Auditoria.Actor actor) {
        repositorio.cola(localId, colaId).orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        validar(d);
        Local local = locales.exigir(localId);
        // Matriz §7: EMPRENDE permite citas en 1 cola
        if (d.activo() && "EMPRENDE".equals(locales.planDe(local).codigo()) && repositorio.otrasColasConCitas(localId, colaId) >= 1) {
            throw new ErrorNegocio("M3_LIMITE_PLAN", "El plan Emprende permite citas en 1 servicio", 402);
        }
        auditoria.fijarActor(actor);
        ConfigCitas previa = repositorio.config(colaId);
        ConfigCitas nueva = new ConfigCitas(d.activo(), d.duracionSlotMin(), d.cuotaCitasPct(), d.capacidadFija(), d.anticipacionMinMin(),
                d.anticipacionMaxDias(), d.checkinAntesMin(), d.checkinDespuesMin(), d.graciaNoShowMin(), d.maxNoShow(), d.bloqueoDias(), d.pesoCita(),
                d.recordatoriosMin() == null || d.recordatoriosMin().isEmpty() ? previa.recordatoriosMin() : d.recordatoriosMin());
        repositorio.guardarConfig(colaId, nueva);
        repositorio.pesoCategoriaCita(localId, d.pesoCita());
        auditoria.registrar(actor, localId, "CITAS_CONFIG", "config_citas", colaId, "Configuró las citas de la cola " + colaId,
                Map.of("activo", d.activo(), "duracionSlotMin", d.duracionSlotMin(), "cuotaCitasPct", d.cuotaCitasPct(), "pesoCita", d.pesoCita()));
        return repositorio.config(colaId);
    }

    private static void validar(ConfigCitas d) {
        rango(d.duracionSlotMin(), 5, 240, "La duración del horario va de 5 a 240 min");
        rango(d.cuotaCitasPct(), 1, 100, "La cuota para citas va de 1 % a 100 %");
        if (d.capacidadFija() != null) {
            rango(d.capacidadFija(), 1, 50, "La capacidad fija va de 1 a 50");
        }
        rango(d.anticipacionMinMin(), 0, 10080, "La anticipación mínima va de 0 a 10080 min");
        rango(d.anticipacionMaxDias(), 1, 60, "La anticipación máxima va de 1 a 60 días");
        rango(d.checkinAntesMin(), 0, 120, "El check-in desde va de 0 a 120 min");
        rango(d.checkinDespuesMin(), 0, 120, "El check-in hasta va de 0 a 120 min");
        rango(d.graciaNoShowMin(), 0, 120, "La gracia va de 0 a 120 min");
        rango(d.maxNoShow(), 0, 20, "Las inasistencias para bloquear van de 0 a 20");
        rango(d.bloqueoDias(), 0, 365, "Los días de bloqueo van de 0 a 365");
        rango(d.pesoCita(), 0, 1000, "El peso de la cita va de 0 a 1000");
    }

    private static void rango(int v, int min, int max, String mensaje) {
        if (v < min || v > max) {
            throw new ErrorNegocio("VALIDACION", mensaje, 422);
        }
    }

    // --- Bloqueos ---

    public record Bloqueos(List<RepositorioCitas.BloqueoAgenda> agenda, List<RepositorioCitas.BloqueoCliente> clientes) {
    }

    public Bloqueos bloqueos(int localId) {
        Instant ahora = reloj.instant();
        return new Bloqueos(repositorio.bloqueosAgendaVigentes(localId, ahora), repositorio.bloqueosClienteVigentes(localId, ahora));
    }

    @Transactional
    public int crearBloqueo(int localId, Integer colaId, Instant inicio, Instant fin, String motivo) {
        if (!fin.isAfter(inicio)) {
            throw new ErrorNegocio("VALIDACION", "El fin debe ser posterior al inicio", 422);
        }
        String m = motivo == null ? "" : motivo.trim();
        if (m.length() < 2 || m.length() > 120) {
            throw new ErrorNegocio("VALIDACION", "El motivo debe tener de 2 a 120 caracteres", 422);
        }
        if (colaId != null) {
            repositorio.cola(localId, colaId).orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        }
        int id = repositorio.crearBloqueoAgenda(localId, colaId, inicio, fin, m);
        repositorio.borrarSlotsLibres(localId, colaId, inicio, fin);
        return id;
    }

    public void eliminarBloqueo(int localId, int id) {
        if (!repositorio.eliminarBloqueoAgenda(localId, id)) {
            throw ErrorNegocio.noEncontrado("NO_ENCONTRADO", "El bloqueo no existe");
        }
    }

    public void liberarCliente(int localId, int id, int usuarioId) {
        if (!repositorio.liberarCliente(localId, id, usuarioId)) {
            throw ErrorNegocio.noEncontrado("NO_ENCONTRADO", "El bloqueo no existe");
        }
    }

    /** Fecha y hora local del formulario de bloqueos ({@code yyyy-MM-ddTHH:mm}) → instante UTC. */
    public Instant instanteLocal(int localId, String fechaHora) {
        var ldt = java.time.LocalDateTime.parse(fechaHora);
        return ldt.atZone(locales.exigir(localId).zonaHoraria()).toInstant();
    }

    /** Disponibilidad para elegir el horario al mover una cita. */
    public DisponibilidadCitas disponibilidad() {
        return disponibilidad;
    }
}
