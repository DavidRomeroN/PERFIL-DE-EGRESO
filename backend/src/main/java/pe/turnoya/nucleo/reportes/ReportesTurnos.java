package pe.turnoya.nucleo.reportes;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.function.Predicate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.nucleo.CanalTurno;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.dominio.Promedios;
import pe.turnoya.nucleo.dominio.RepositorioReportes;
import pe.turnoya.nucleo.dominio.RepositorioReportes.FilaReporte;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;

/** Caso de uso "reporte de espera" (RF09): agrega los turnos de un rango por día, hora, cola, estado y canal. */
@Service
public class ReportesTurnos {

    /** Rango máximo para no cargar años de turnos en memoria. */
    static final int MAX_DIAS = 366;

    private final RepositorioReportes repositorio;
    private final CatalogoLocales locales;
    private final Clock reloj;

    ReportesTurnos(RepositorioReportes repositorio, CatalogoLocales locales, Clock reloj) {
        this.repositorio = repositorio;
        this.locales = locales;
        this.reloj = reloj;
    }

    /** Fecha de hoy en la zona del local menos {@code dias}. */
    public LocalDate haceDias(int localId, int dias) {
        return Fechas.fechaLocal(locales.exigir(localId).zonaHoraria(), reloj.instant()).minusDays(dias);
    }

    @Transactional(readOnly = true)
    public ReporteEspera generar(int localId, LocalDate desde, LocalDate hasta) {
        if (hasta.isBefore(desde)) {
            throw new ErrorNegocio("VALIDACION", "La fecha final no puede ser anterior a la inicial", 422);
        }
        if (ChronoUnit.DAYS.between(desde, hasta) >= MAX_DIAS) {
            throw new ErrorNegocio("VALIDACION", "El rango máximo es de un año", 422);
        }
        Local local = locales.exigir(localId);
        return calcular(repositorio.turnosDelRango(localId, desde, hasta), desde, hasta, local.zonaHoraria());
    }

    static ReporteEspera calcular(List<FilaReporte> turnos, LocalDate desde, LocalDate hasta, ZoneId zona) {
        int total = turnos.size();
        int atendidos = contar(turnos, t -> t.estado() == EstadoTurno.ATENDIDO);
        int noPresentados = contar(turnos, t -> t.estado() == EstadoTurno.NO_SE_PRESENTO);
        int cancelados = contar(turnos, t -> t.estado() == EstadoTurno.CANCELADO);
        int porQr = contar(turnos, t -> t.canal() == CanalTurno.QR);
        List<Long> espera = turnos.stream().map(ReportesTurnos::esperaMs).filter(Objects::nonNull).toList();
        List<Long> atencion = turnos.stream().map(ReportesTurnos::atencionMs).filter(Objects::nonNull).toList();
        var resumen = new ReporteEspera.Resumen(total, atendidos, noPresentados, cancelados,
                Promedios.porcentaje1(noPresentados + cancelados, total), Promedios.porcentaje(porQr, total),
                Promedios.minutos(espera), espera.isEmpty() ? 0 : Math.round(espera.stream().mapToLong(Long::longValue).max().orElse(0) / 6000.0) / 10.0,
                Promedios.minutos(atencion));

        Map<LocalDate, List<FilaReporte>> dias = new TreeMap<>();
        turnos.forEach(t -> dias.computeIfAbsent(t.fecha(), f -> new ArrayList<>()).add(t));
        List<ReporteEspera.PorDia> porDia = dias.entrySet().stream().map(e -> new ReporteEspera.PorDia(e.getKey(), e.getValue().size(),
                contar(e.getValue(), t -> t.estado() == EstadoTurno.ATENDIDO), contar(e.getValue(), ReportesTurnos::abandono),
                Promedios.minutos(e.getValue().stream().map(ReportesTurnos::esperaMs).filter(Objects::nonNull).toList()))).toList();

        Map<Integer, List<FilaReporte>> horas = new TreeMap<>();
        turnos.forEach(t -> horas.computeIfAbsent(t.emitidoAt().atZone(zona).getHour(), h -> new ArrayList<>()).add(t));
        List<ReporteEspera.PorHora> porHora = new ArrayList<>();
        for (int h = 6; h <= 21; h++) {
            List<FilaReporte> deLaHora = horas.getOrDefault(h, List.of());
            porHora.add(new ReporteEspera.PorHora(h, "%02d:00".formatted(h), deLaHora.size(),
                    Promedios.minutos(deLaHora.stream().map(ReportesTurnos::esperaMs).filter(Objects::nonNull).toList())));
        }

        Map<Integer, List<FilaReporte>> colas = new LinkedHashMap<>();
        turnos.forEach(t -> colas.computeIfAbsent(t.colaId(), c -> new ArrayList<>()).add(t));
        List<ReporteEspera.PorCola> porCola = colas.values().stream().map(lista -> {
            int n = lista.size();
            int abandonos = contar(lista, ReportesTurnos::abandono);
            return new ReporteEspera.PorCola(lista.getFirst().cola(), lista.getFirst().prefijo(), n,
                    contar(lista, t -> t.estado() == EstadoTurno.ATENDIDO), abandonos, Promedios.porcentaje1(abandonos, n),
                    Promedios.minutos(lista.stream().map(ReportesTurnos::esperaMs).filter(Objects::nonNull).toList()),
                    Promedios.minutos(lista.stream().map(ReportesTurnos::atencionMs).filter(Objects::nonNull).toList()));
        }).toList();

        List<ReporteEspera.PorEstado> porEstado = Arrays.stream(EstadoTurno.values()).filter(e -> e != EstadoTurno.TRANSFERIDO)
                .map(e -> new ReporteEspera.PorEstado(e, contar(turnos, t -> t.estado() == e))).toList();
        List<ReporteEspera.PorCanal> porCanal = Arrays.stream(CanalTurno.values())
                .map(c -> {
                    int n = contar(turnos, t -> t.canal() == c);
                    return new ReporteEspera.PorCanal(c, n, Promedios.porcentaje(n, total));
                })
                .filter(c -> c.cantidad() > 0).toList();

        List<ReporteEspera.Detalle> detalle = turnos.stream().map(t -> new ReporteEspera.Detalle(t.id(), t.fecha(), t.codigo(), t.cola(),
                t.estado(), t.canal(), Objects.requireNonNullElse(t.ventanilla(), ""), t.emitidoAt(), t.llamadoAt(), t.finalizadoAt(),
                minutos(esperaMs(t)), minutos(atencionMs(t)))).toList();

        return new ReporteEspera(new ReporteEspera.Rango(desde, hasta), resumen, porDia, porHora, porCola, porEstado, porCanal, detalle);
    }

    private static boolean abandono(FilaReporte t) {
        return t.estado() == EstadoTurno.NO_SE_PRESENTO || t.estado() == EstadoTurno.CANCELADO;
    }

    private static Long esperaMs(FilaReporte t) {
        return Promedios.entre(t.emitidoAt(), t.llamadoAt());
    }

    private static Long atencionMs(FilaReporte t) {
        return t.estado() == EstadoTurno.ATENDIDO ? Promedios.entre(t.llamadoAt(), t.finalizadoAt()) : null;
    }

    private static Double minutos(Long ms) {
        return ms == null ? null : Math.round(ms / 6000.0) / 10.0;
    }

    private static int contar(List<FilaReporte> turnos, Predicate<FilaReporte> condicion) {
        return (int) turnos.stream().filter(condicion).count();
    }
}
