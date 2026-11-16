package pe.turnoya.citas.agenda;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import pe.turnoya.citas.dominio.ReglasCitas;
import pe.turnoya.citas.dominio.RepositorioCitas;
import pe.turnoya.citas.dominio.RepositorioCitas.ColaCitas;
import pe.turnoya.citas.dominio.RepositorioCitas.ConfigCitas;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;

/** §6.1 Slots: generación perezosa e idempotente desde el horario del local, menos bloqueos; cupos por día. */
@Service
public class DisponibilidadCitas {

    public static final DateTimeFormatter HORA = DateTimeFormatter.ofPattern("HH:mm");

    private final RepositorioCitas repositorio;
    private final CatalogoLocales locales;
    private final ModulosLocal modulos;
    private final Clock reloj;

    DisponibilidadCitas(RepositorioCitas repositorio, CatalogoLocales locales, ModulosLocal modulos, Clock reloj) {
        this.repositorio = repositorio;
        this.locales = locales;
        this.modulos = modulos;
        this.reloj = reloj;
    }

    /** Local activo con M3 por su slug (404 si no existe, 403 si no tiene el módulo). */
    public Local localPublico(String slug) {
        Local local = locales.porSlug(slug).filter(Local::activo)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("LOCAL_NO_ENCONTRADO", "El local no existe"));
        modulos.exigir(local.id(), Modulo.M3);
        return local;
    }

    public record ColaConConfig(ColaCitas cola, ConfigCitas config) {
    }

    public record ConfigResumen(int duracionSlotMin, int anticipacionMaxDias) {
    }

    public record ServicioPublico(int id, String nombre, String descripcion, ConfigResumen configCitas) {
    }

    public record LocalCitas(String nombre, String color, String slug, String direccion, String logoUrl, String rubro) {
    }

    public record Servicios(boolean disponible, LocalCitas local, List<ServicioPublico> colas) {
    }

    /** GET /public/locales/:slug/citas — servicios que atienden con cita (vacío si el local no tiene M3). */
    public Servicios servicios(String slug) {
        Local local = locales.porSlug(slug).filter(Local::activo).orElse(null);
        if (local == null || !modulos.activo(local.id(), Modulo.M3)) {
            return new Servicios(false, local == null ? null : resumen(local), List.of());
        }
        var colas = repositorio.colasDelLocal(local.id()).stream().filter(ColaCitas::conCitas).map(c -> {
            ConfigCitas cfg = repositorio.config(c.id());
            return new ServicioPublico(c.id(), c.nombre(), c.descripcion(), new ConfigResumen(cfg.duracionSlotMin(), cfg.anticipacionMaxDias()));
        }).toList();
        return new Servicios(!colas.isEmpty(), resumen(local), colas);
    }

    private static LocalCitas resumen(Local l) {
        return new LocalCitas(l.nombreComercial(), l.colorPrimario(), l.slug(), l.direccion(), l.logoUrl(), l.rubro());
    }

    /** La cola del local que atiende con cita (404 si no existe, 409 si no tiene citas). */
    public ColaConConfig colaConCitas(int localId, int colaId) {
        ColaCitas cola = repositorio.cola(localId, colaId).filter(ColaCitas::activa)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        ConfigCitas cfg = repositorio.config(colaId);
        if (!cfg.activo()) {
            throw ErrorNegocio.conflicto("M3_COLA_SIN_CITAS", "Este servicio no atiende con cita");
        }
        return new ColaConConfig(cola, cfg);
    }

    public int generarSlots(Local local, int colaId, LocalDate fecha) {
        ColaCitas cola = repositorio.cola(local.id(), colaId).orElse(null);
        ConfigCitas cfg = repositorio.config(colaId);
        if (cola == null || !cfg.activo()) {
            return 0;
        }
        ZoneId zona = local.zonaHoraria();
        int diaSemana = Fechas.partes(zona, Fechas.instanteLocal(fecha, 12, 0, zona)).diaSemana();
        var tramos = repositorio.horarios(local.id(), diaSemana);
        if (tramos.isEmpty()) {
            return 0;
        }
        Instant inicioDia = Fechas.instanteLocal(fecha, 0, 0, zona);
        var bloqueos = repositorio.bloqueosAgenda(local.id(), colaId, inicioDia.minus(Duration.ofDays(1)), inicioDia.plus(Duration.ofDays(2)));
        var franjas = ReglasCitas.franjasDelDia(fecha, tramos, cfg.duracionSlotMin(), zona, bloqueos, reloj.instant());
        if (franjas.isEmpty()) {
            return 0;
        }
        int capacidad = ReglasCitas.capacidadSlot(Math.max(1, cola.ventanillasActivas()), cfg.cuotaCitasPct(), cfg.capacidadFija());
        return repositorio.insertarSlots(colaId, franjas, capacidad);
    }

    public record SlotPublico(int id, Instant inicio, Instant fin, String hora, int restantes, boolean disponible) {
    }

    /** GET /public/locales/:slug/slots — horarios de un día con cupos restantes. */
    public List<SlotPublico> slotsDelDia(Local local, int colaId, LocalDate fecha) {
        ConfigCitas cfg = colaConCitas(local.id(), colaId).config();
        generarSlots(local, colaId, fecha);
        Instant ahora = reloj.instant();
        ZoneId zona = local.zonaHoraria();
        Instant desde = Fechas.instanteLocal(fecha, 0, 0, zona);
        return repositorio.slots(local.id(), colaId, desde, desde.plus(Duration.ofDays(1))).stream()
                .filter(s -> Fechas.fechaLocal(zona, s.inicio()).equals(fecha))
                .map(s -> new SlotPublico(s.id(), s.inicio(), s.fin(), HORA.format(s.inicio().atZone(zona)), Math.max(0, s.capacidad() - s.reservados()),
                        s.reservados() < s.capacidad()
                                && ReglasCitas.dentroDeAnticipacion(s.inicio(), ahora, cfg.anticipacionMinMin(), cfg.anticipacionMaxDias())))
                .toList();
    }

    public record DiaDisponible(LocalDate fecha, boolean abierto, int libres) {
    }

    /** GET /public/locales/:slug/disponibilidad — resumen por día. */
    public List<DiaDisponible> disponibilidad(Local local, int colaId, int dias) {
        ConfigCitas cfg = colaConCitas(local.id(), colaId).config();
        LocalDate hoy = Fechas.fechaLocal(local.zonaHoraria(), reloj.instant());
        int n = Math.min(dias, cfg.anticipacionMaxDias() + 1);
        List<DiaDisponible> salida = new ArrayList<>();
        for (int d = 0; d < n; d++) {
            LocalDate f = hoy.plusDays(d);
            var slots = slotsDelDia(local, colaId, f);
            salida.add(new DiaDisponible(f, !slots.isEmpty(), slots.stream().filter(SlotPublico::disponible).mapToInt(SlotPublico::restantes).sum()));
        }
        return salida;
    }

    /** Job: prepara los slots de los próximos días de las colas con citas activas. */
    public Map<String, Object> jobGenerarSlots() {
        int n = 0;
        for (var cfg : repositorio.configsActivas()) {
            if (!modulos.activo(cfg.localId(), Modulo.M3)) {
                continue;
            }
            Local local = locales.exigir(cfg.localId());
            LocalDate hoy = Fechas.fechaLocal(local.zonaHoraria(), reloj.instant());
            for (int d = 0; d <= cfg.anticipacionMaxDias(); d++) {
                n += generarSlots(local, cfg.colaId(), hoy.plusDays(d));
            }
        }
        return Map.of("slotsCreados", n);
    }
}
