package pe.turnoya.analitica.tablero;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.analitica.dominio.ReglasAnalitica;
import pe.turnoya.analitica.dominio.RepositorioAnalitica;
import pe.turnoya.analitica.dominio.RepositorioAnalitica.Agrupar;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;

/** §6.1–6.3, §6.8 Consultas de analítica: percentiles (no promedios), mapa de calor, SLA con presupuesto de error y CSAT. */
@Service
public class ConsultasAnalitica {

    private static final String[] DIAS = {"Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"};

    private final RepositorioAnalitica repositorio;
    private final CatalogoLocales locales;
    private final ModulosLocal modulos;
    private final Auditoria auditoria;
    private final Clock reloj;

    ConsultasAnalitica(RepositorioAnalitica repositorio, CatalogoLocales locales, ModulosLocal modulos, Auditoria auditoria, Clock reloj) {
        this.repositorio = repositorio;
        this.locales = locales;
        this.modulos = modulos;
        this.auditoria = auditoria;
        this.reloj = reloj;
    }

    public record Rango(LocalDate desde, LocalDate hasta) {
    }

    /** Rango por defecto: las últimas 8 semanas hasta hoy (zona del local). */
    public Rango rango(int localId, String desde, String hasta) {
        modulos.exigir(localId, Modulo.M7);
        LocalDate hoy = Fechas.fechaLocal(locales.exigir(localId).zonaHoraria(), reloj.instant());
        try {
            LocalDate h = hasta == null || hasta.isBlank() ? hoy : LocalDate.parse(hasta);
            LocalDate d = desde == null || desde.isBlank() ? h.minusDays(55) : LocalDate.parse(desde);
            if (d.isAfter(h) || d.isBefore(h.minusDays(400))) {
                throw new IllegalArgumentException();
            }
            return new Rango(d, h);
        } catch (RuntimeException e) {
            throw new ErrorNegocio("VALIDACION", "Rango de fechas inválido", 422);
        }
    }

    // --- Percentiles ---

    public record Tiempos(Double p50, Double p90, Double p95) {
    }

    public record Percentil(String grupo, int n, Tiempos espera, Tiempos atencion) {
    }

    public List<Percentil> percentiles(int localId, Rango r, Integer colaId, String agrupar) {
        Agrupar a;
        try {
            a = Agrupar.valueOf((agrupar == null ? "cola" : agrupar).toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new ErrorNegocio("VALIDACION", "Agrupación inválida", 422);
        }
        return repositorio.percentiles(localId, r.desde(), r.hasta(), colaId, a, zona(localId)).stream()
                .map(f -> new Percentil(f.grupo(), f.n(), new Tiempos(r1(f.p50()), r1(f.p90()), r1(f.p95())), new Tiempos(r1(f.a50()), r1(f.a90()), r1(f.a95()))))
                .toList();
    }

    // --- Mapa de calor ---

    public record Celda(int hora, double valor, int n, boolean confiable) {
    }

    public record FilaCalor(int dow, String dia, List<Celda> celdas) {
    }

    public record MapaCalor(String metrica, List<Integer> horas, List<FilaCalor> matriz, double maximo) {

        /** Opacidad (0–1) de la celda para pintarla. */
        public double intensidad(double valor) {
            return maximo <= 0 ? 0 : Math.round(valor / maximo * 100) / 100.0;
        }
    }

    public MapaCalor mapaDeCalor(int localId, Rango r, Integer colaId, String metrica) {
        String m = metrica == null ? "llegadas" : metrica;
        if (!List.of("llegadas", "espera_p90", "abandono").contains(m)) {
            throw new ErrorNegocio("VALIDACION", "Métrica inválida", 422);
        }
        var filas = repositorio.mapaDeCalor(localId, r.desde(), r.hasta(), colaId, zona(localId));
        int[] ocurrencias = new int[7];
        for (LocalDate d = r.desde(); !d.isAfter(r.hasta()); d = d.plusDays(1)) {
            ocurrencias[d.getDayOfWeek().getValue() % 7]++;
        }
        List<Integer> horas = new ArrayList<>();
        for (int h = 6; h <= 21; h++) {
            horas.add(h);
        }
        List<FilaCalor> matriz = new ArrayList<>();
        double max = 0;
        for (int dow : new int[] {1, 2, 3, 4, 5, 6, 0}) {
            List<Celda> celdas = new ArrayList<>();
            for (int h : horas) {
                var c = filas.stream().filter(x -> x.dow() == dow && x.hora() == h).findFirst().orElse(null);
                double valor = c == null ? 0 : switch (m) {
                    case "llegadas" -> r1((double) c.llegadas() / Math.max(1, ocurrencias[dow]));
                    case "abandono" -> r1((double) c.abandonos() / Math.max(1, c.llegadas()) * 100);
                    default -> c.p90() == null ? 0 : r1(c.p90());
                };
                int n = c == null ? 0 : "espera_p90".equals(m) ? c.n() : c.llegadas();
                max = Math.max(max, valor);
                celdas.add(new Celda(h, valor, n, n >= 5));
            }
            matriz.add(new FilaCalor(dow, DIAS[dow], celdas));
        }
        return new MapaCalor(m, horas, matriz, max);
    }

    // --- SLA ---

    public record EstadoSla(int colaId, String cola, boolean configurado, Integer esperaMaxMin, Double objetivoPct, Integer ventanaMin, int muestra,
                            int cumplen, int incumplen, int pendientes, int enRiesgo, Double cumplimiento, Boolean cumple, Double cumplimientoPct,
                            Double presupuestoConsumido) {

        public int presupuestoPct() {
            return presupuestoConsumido == null ? 100 : (int) Math.min(100, Math.round(presupuestoConsumido * 100));
        }
    }

    /** Estado actual del SLA por cola en su ventana móvil (censura a la derecha). */
    public List<EstadoSla> estadoSla(int localId) {
        Instant ahora = reloj.instant();
        List<EstadoSla> salida = new ArrayList<>();
        for (var c : repositorio.colasConSla(localId)) {
            if (!c.configurado()) {
                salida.add(new EstadoSla(c.colaId(), c.cola(), false, c.esperaMaxMin(), c.objetivoPct(), c.ventanaMin(), 0, 0, 0, 0, 0, null, null, null, null));
                continue;
            }
            var turnos = repositorio.turnosDesde(c.colaId(), ahora.minus(Duration.ofMinutes(c.ventanaMin()))).stream()
                    .map(t -> new ReglasAnalitica.TurnoSla(t.estado(), t.llamadoAt() != null,
                            Duration.between(t.emitidoAt(), t.llamadoAt() != null ? t.llamadoAt() : t.finalizadoAt() != null ? t.finalizadoAt() : ahora)
                                    .toMillis() / 1000.0))
                    .toList();
            var r = ReglasAnalitica.cumplimientoSla(turnos, c.esperaMaxMin(), c.objetivoPct());
            salida.add(new EstadoSla(c.colaId(), c.cola(), true, c.esperaMaxMin(), c.objetivoPct(), c.ventanaMin(), r.muestra(), r.cumplen(), r.incumplen(),
                    r.pendientes(), r.enRiesgo(), r.cumplimiento(), r.cumple(), r.cumplimiento() == null ? null : Math.round(r.cumplimiento() * 1000) / 10.0,
                    r.presupuestoConsumido() == null ? null : Math.round(r.presupuestoConsumido() * 100) / 100.0));
        }
        return salida;
    }

    public record PuntoSla(Instant hora, Double cumplimientoPct, int n) {
    }

    public List<PuntoSla> serieSla(int localId, int colaId, int dias) {
        modulos.exigir(localId, Modulo.M7);
        var c = repositorio.colaConSla(colaId, localId).orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        if (c.esperaMaxMin() == null) {
            return List.of();
        }
        return repositorio.serieSla(colaId, c.esperaMaxMin() * 60, reloj.instant().minus(Duration.ofDays(Math.max(1, Math.min(30, dias))))).stream()
                .map(p -> new PuntoSla(p.hora(), p.total() == 0 ? null : Math.round((double) p.cumplen() / p.total() * 1000) / 10.0, p.total()))
                .toList();
    }

    public record SlaGuardado(int colaId, int esperaMaxMin, double objetivoPct, int ventanaMin, boolean activo) {
    }

    /** {@code PUT /api/v1/sla/{colaId}}; lo audita el trigger (RN-M7-09). */
    @Transactional
    public SlaGuardado guardarSla(Auditoria.Actor actor, int localId, int colaId, Integer esperaMaxMin, Double objetivoPct, Integer ventanaMin, Boolean activo) {
        modulos.exigir(localId, Modulo.M7);
        var c = repositorio.colaConSla(colaId, localId).orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        if (esperaMaxMin == null || esperaMaxMin < 1 || esperaMaxMin > 480) {
            throw new ErrorNegocio("VALIDACION", "La espera máxima debe estar entre 1 y 480 min", 422);
        }
        if (objetivoPct == null || objetivoPct < 1 || objetivoPct > 100) {
            throw new ErrorNegocio("VALIDACION", "El objetivo debe estar entre 1 y 100 %", 422);
        }
        int ventana = ventanaMin == null ? 60 : ventanaMin;
        if (ventana < 15 || ventana > 1440) {
            throw new ErrorNegocio("VALIDACION", "La ventana debe estar entre 15 y 1440 min", 422);
        }
        boolean act = activo == null || activo;
        auditoria.fijarActor(actor);
        repositorio.guardarSla(c.colaId(), esperaMaxMin, objetivoPct, ventana, act);
        auditoria.registrar(actor, localId, "SLA_GUARDAR", "sla_cola", colaId, "Definió el SLA de " + c.cola() + ": " + objetivoPct + " % en ≤ " + esperaMaxMin + " min",
                null);
        return new SlaGuardado(colaId, esperaMaxMin, objetivoPct, ventana, act);
    }

    // --- CSAT ---

    public record Distribucion(int estrellas, int cantidad) {
    }

    public record Tramo(String tramo, int n, Double promedio) {
    }

    public record Comentario(int estrellas, String comentario, Instant fecha) {
    }

    public record Csat(int n, Double promedio, Double pctSatisfechos, List<Distribucion> distribucion, List<Tramo> porTramo, List<Comentario> comentarios) {
    }

    public Csat csat(int localId, Rango r) {
        var filas = repositorio.valoraciones(localId, r.desde(), r.hasta());
        int n = filas.size();
        Double promedio = n == 0 ? null : r1(filas.stream().mapToInt(RepositorioAnalitica.FilaValoracion::estrellas).average().orElse(0));
        Double pct = n == 0 ? null : Math.round(filas.stream().filter(f -> f.estrellas() >= 4).count() * 1000.0 / n) / 10.0;
        List<Distribucion> dist = new ArrayList<>();
        for (int e = 1; e <= 5; e++) {
            int ee = e;
            dist.add(new Distribucion(e, (int) filas.stream().filter(f -> f.estrellas() == ee).count()));
        }
        String[] etiquetas = {"0–5 min", "5–10 min", "10–20 min", "20–30 min", "30+ min"};
        double[] lim = {0, 5, 10, 20, 30, Double.MAX_VALUE};
        List<Tramo> tramos = new ArrayList<>();
        for (int i = 0; i < etiquetas.length; i++) {
            double min = lim[i];
            double max = lim[i + 1];
            var xs = filas.stream().filter(f -> f.llamadoAt() != null).filter(f -> {
                double m = Duration.between(f.emitidoAt(), f.llamadoAt()).toMillis() / 60000.0;
                return m >= min && m < max;
            }).mapToInt(RepositorioAnalitica.FilaValoracion::estrellas).toArray();
            tramos.add(new Tramo(etiquetas[i], xs.length, xs.length == 0 ? null : r1(java.util.Arrays.stream(xs).average().orElse(0))));
        }
        // Comentarios sin datos personales (solo texto, sin vínculo al cliente)
        var comentarios = filas.stream().filter(f -> f.comentario() != null && !f.comentario().isBlank()).limit(20)
                .map(f -> new Comentario(f.estrellas(), f.comentario(), f.createdAt())).toList();
        return new Csat(n, promedio, pct, dist, tramos, comentarios);
    }

    // --- Resumen ---

    public record ResumenCsat(Double promedio, Double pctSatisfechos, int n) {
    }

    public record Resumen(LocalDate desde, LocalDate hasta, int total, int atendidos, double tasaAbandono, Map<String, Integer> porEstado,
                          List<Percentil> percentiles, List<EstadoSla> sla, ResumenCsat csat) {
    }

    public Resumen resumen(int localId, Rango r, Integer colaId) {
        var conteo = repositorio.conteoPorEstado(localId, r.desde(), r.hasta(), colaId);
        int total = conteo.values().stream().mapToInt(Integer::intValue).sum();
        int abandonos = conteo.getOrDefault("CANCELADO", 0) + conteo.getOrDefault("NO_SE_PRESENTO", 0);
        var c = csat(localId, r);
        return new Resumen(r.desde(), r.hasta(), total, conteo.getOrDefault("ATENDIDO", 0), total == 0 ? 0 : Math.round(abandonos * 1000.0 / total) / 10.0,
                conteo, percentiles(localId, r, colaId, "cola"), estadoSla(localId), new ResumenCsat(c.promedio(), c.pctSatisfechos(), c.n()));
    }

    /** Job {@code analitica-refrescar-mv}. */
    public String refrescarVista() {
        long t0 = System.currentTimeMillis();
        repositorio.refrescarVista();
        return "ms=" + (System.currentTimeMillis() - t0);
    }

    private String zona(int localId) {
        Local l = locales.exigir(localId);
        return l.zonaHoraria().getId();
    }

    private static Double r1(Double x) {
        return x == null ? null : Math.round(x * 10) / 10.0;
    }

    private static double r1(double x) {
        return Math.round(x * 10) / 10.0;
    }
}
