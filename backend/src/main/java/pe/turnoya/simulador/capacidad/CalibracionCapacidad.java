package pe.turnoya.simulador.capacidad;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.estadistica.Estadistica;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.simulador.dominio.ParametrosSimulacion;
import pe.turnoya.simulador.dominio.RepositorioSimulador;
import pe.turnoya.simulador.dominio.RepositorioSimulador.TurnoHistorico;
import pe.turnoya.simulador.dominio.SimulacionEventos;

/**
 * Calibración desde el histórico (§6.4) y validación con días pasados (backtest, §7) de una cola. Las franjas son de
 * 30 minutos en la hora del local.
 */
@Service
public class CalibracionCapacidad {

    static final int DIAS_CALIBRACION = 28;
    static final int DIAS_VALIDACION = 14;
    private static final int MIN_ATENCIONES = 20;

    private final RepositorioSimulador repositorio;
    private final CatalogoLocales locales;
    private final Clock reloj;

    CalibracionCapacidad(RepositorioSimulador repositorio, CatalogoLocales locales, Clock reloj) {
        this.repositorio = repositorio;
        this.locales = locales;
        this.reloj = reloj;
    }

    public record Calibracion(int colaId, String cola, int dias, String confianza, int n, String apertura, String cierre,
                              List<ParametrosSimulacion.Tramo> lambdaPorHora, List<ParametrosSimulacion.TramoVentanillas> ventanillas,
                              double servicioMedia, double servicioCv, double servicioMediana, double servicioP90, List<Double> muestras,
                              Double pacienciaMedia, Double noShowP, List<String> avisos) {

        double lambdaMedia() {
            return lambdaPorHora.stream().mapToDouble(ParametrosSimulacion.Tramo::valor).average().orElse(0);
        }

        int ventanillasMedia() {
            return (int) Math.max(1, Math.round(ventanillas.stream().mapToInt(ParametrosSimulacion.TramoVentanillas::c).average().orElse(1)));
        }
    }

    /** Lunes a viernes: el día típico de atención (como el sistema anterior). */
    public Calibracion calibrar(int localId, int colaId) {
        var cola = repositorio.cola(localId, colaId).orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        ZoneId zona = locales.exigir(localId).zonaHoraria();
        LocalDate hasta = Fechas.fechaLocal(zona, reloj.instant());
        LocalDate desde = hasta.minusDays(DIAS_CALIBRACION);
        List<TurnoHistorico> turnos = repositorio.turnos(colaId, desde, hasta);

        Map<Integer, Integer> llegadas = new TreeMap<>();
        Set<LocalDate> dias = new HashSet<>();
        for (var t : turnos) {
            if (laborable(t.fecha())) {
                dias.add(t.fecha());
                if (!t.transferido()) {
                    llegadas.merge(franja(zona, t.emitidoAt()), 1, Integer::sum);
                }
            }
        }
        List<Double> srv = new ArrayList<>();
        int noShows = 0;
        List<Double> esperaCancelados = new ArrayList<>();
        Map<Integer, Map<LocalDate, Set<Integer>>> ventanillasPorFranja = new TreeMap<>();
        for (var t : turnos) {
            if ("ATENDIDO".equals(t.estado()) && t.llamadoAt() != null && t.finalizadoAt() != null) {
                double min = minutos(t.llamadoAt(), t.finalizadoAt());
                if (min >= 0.5 && min <= 60) {
                    srv.add(min);
                }
            }
            if ("NO_SE_PRESENTO".equals(t.estado())) {
                noShows++;
            }
            if ("CANCELADO".equals(t.estado()) && t.finalizadoAt() != null) {
                esperaCancelados.add(minutos(t.emitidoAt(), t.finalizadoAt()));
            }
            if (t.llamadoAt() != null && t.ventanillaId() != null) {
                ventanillasPorFranja.computeIfAbsent(franja(zona, t.llamadoAt()), k -> new HashMap<>())
                        .computeIfAbsent(t.fecha(), k -> new HashSet<>()).add(t.ventanillaId());
            }
        }
        if (srv.size() < MIN_ATENCIONES || llegadas.isEmpty()) {
            throw ErrorNegocio.conflicto("M8_SIN_DATOS", "No hay suficiente histórico de " + cola.nombre() + " para calibrar: hacen falta al menos "
                    + MIN_ATENCIONES + " atenciones en las últimas 4 semanas (hay " + srv.size() + ").");
        }
        var ln = SimulacionEventos.ajustarLogNormal(srv);
        int totalDias = Math.max(1, dias.size());
        int primera = llegadas.keySet().iterator().next();
        int ultima = ((TreeMap<Integer, Integer>) llegadas).lastKey();
        List<ParametrosSimulacion.Tramo> lambda = llegadas.entrySet().stream()
                .map(e -> new ParametrosSimulacion.Tramo(hhmm(e.getKey()), Math.round(e.getValue() * 2.0 / totalDias * 10) / 10.0)).toList();
        List<ParametrosSimulacion.TramoVentanillas> ventanillas = ventanillasPorFranja.entrySet().stream()
                .filter(e -> e.getKey() >= primera && e.getKey() <= ultima)
                .map(e -> new ParametrosSimulacion.TramoVentanillas(hhmm(e.getKey()),
                        (int) Math.max(1, Math.round(Estadistica.mediana(e.getValue().values().stream().map(Set::size).toList())))))
                .toList();
        if (ventanillas.isEmpty()) {
            ventanillas = List.of(new ParametrosSimulacion.TramoVentanillas(hhmm(primera), 1));
        }
        Double paciencia = esperaCancelados.size() >= 10 ? Estadistica.media(esperaCancelados) : null;
        int n = srv.size();
        List<String> avisos = new ArrayList<>();
        if (paciencia != null) {
            avisos.add("La paciencia se estima con la espera de quienes cancelaron: tiende a subestimarse.");
        }
        return new Calibracion(colaId, cola.nombre(), DIAS_CALIBRACION, n >= 300 ? "alta" : n >= 100 ? "media" : "baja", n, hhmm(primera), hhmm(ultima + 1),
                lambda, ventanillas, redondear(ln.media()), redondear(ln.cv()), redondear(Estadistica.mediana(srv)), redondear(Estadistica.cuantil(srv, 0.9)),
                srv.size() > 2000 ? srv.subList(0, 2000) : srv, paciencia, turnos.isEmpty() ? null : (double) noShows / turnos.size(), avisos);
    }

    public record DiaValidado(LocalDate fecha, int turnos, double esperaObservada, double esperaSimulada, double p90Observado, double p90Simulado,
                              double error) {
    }

    /** Simula cada uno de los últimos días con sus llegadas y ventanillas reales y lo compara con lo observado. */
    public List<DiaValidado> validar(int localId, int colaId, ParametrosSimulacion base) {
        repositorio.cola(localId, colaId).orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        ZoneId zona = locales.exigir(localId).zonaHoraria();
        LocalDate hasta = Fechas.fechaLocal(zona, reloj.instant());
        Map<LocalDate, List<TurnoHistorico>> porDia = new TreeMap<>();
        for (var t : repositorio.turnos(colaId, hasta.minusDays(DIAS_VALIDACION), hasta)) {
            if (!t.transferido()) {
                porDia.computeIfAbsent(t.fecha(), k -> new ArrayList<>()).add(t);
            }
        }
        List<DiaValidado> salida = new ArrayList<>();
        for (var dia : porDia.entrySet()) {
            List<TurnoHistorico> ts = dia.getValue();
            if (ts.size() < 10) {
                continue;
            }
            Map<Integer, Integer> lleg = new TreeMap<>();
            Map<Integer, Set<Integer>> vent = new TreeMap<>();
            List<Double> esperas = new ArrayList<>();
            for (var t : ts) {
                lleg.merge(franja(zona, t.emitidoAt()), 1, Integer::sum);
                if (t.llamadoAt() != null) {
                    esperas.add(minutos(t.emitidoAt(), t.llamadoAt()));
                    if (t.ventanillaId() != null) {
                        vent.computeIfAbsent(franja(zona, t.llamadoAt()), k -> new HashSet<>()).add(t.ventanillaId());
                    }
                }
            }
            if (esperas.isEmpty()) {
                continue;
            }
            int primera = lleg.keySet().iterator().next();
            int ultima = ((TreeMap<Integer, Integer>) lleg).lastKey();
            var llegadas = lleg.entrySet().stream().map(e -> new ParametrosSimulacion.Tramo(hhmm(e.getKey()), e.getValue() * 2.0)).toList();
            var ventanillas = vent.entrySet().stream().map(e -> new ParametrosSimulacion.TramoVentanillas(hhmm(e.getKey()), e.getValue().size())).toList();
            if (ventanillas.isEmpty()) {
                ventanillas = List.of(new ParametrosSimulacion.TramoVentanillas(hhmm(primera), 1));
            }
            var r = SimulacionEventos.monteCarlo(base.conDia(hhmm(primera), hhmm(ultima + 1), llegadas, ventanillas, 100));
            double obs = Estadistica.media(esperas);
            double error = obs > 0 ? Math.abs(r.esperaMedia().media() - obs) / obs : 0;
            salida.add(new DiaValidado(dia.getKey(), ts.size(), obs, r.esperaMedia().media(), Estadistica.cuantil(esperas, 0.9), r.esperaP90().media(), error));
        }
        return salida;
    }

    private static boolean laborable(LocalDate fecha) {
        DayOfWeek d = fecha.getDayOfWeek();
        return d != DayOfWeek.SATURDAY && d != DayOfWeek.SUNDAY;
    }

    private static int franja(ZoneId zona, Instant instante) {
        var p = Fechas.partes(zona, instante);
        return p.hora() * 2 + p.minuto() / 30;
    }

    private static String hhmm(int franja) {
        int f = Math.min(franja, 47);
        if (franja >= 48) {
            return "23:59";
        }
        return String.format("%02d:%s", f / 2, f % 2 == 1 ? "30" : "00");
    }

    private static double minutos(Instant desde, Instant hasta) {
        return Duration.between(desde, hasta).toMillis() / 60000.0;
    }

    private static double redondear(double x) {
        return Math.round(x * 100) / 100.0;
    }
}
