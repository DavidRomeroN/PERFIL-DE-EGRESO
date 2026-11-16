package pe.turnoya.prediccion.entrenamiento;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.estadistica.Estadistica;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.prediccion.DerivaDetectada;
import pe.turnoya.prediccion.dominio.ModelosEspera;
import pe.turnoya.prediccion.dominio.ModelosEspera.Entrenamiento;
import pe.turnoya.prediccion.dominio.ModelosEspera.MuestraTurno;
import pe.turnoya.prediccion.dominio.ModelosEspera.Tipo;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion.ModeloFila;
import pe.turnoya.prediccion.estimacion.ModelosActivos;

/** Entrenamiento walk-forward de los tres modelos por cola, elección AUTO con histéresis y vigilancia de deriva (§6.6–6.8). */
@Service
public class EntrenamientoModelos {

    private static final Logger log = LoggerFactory.getLogger(EntrenamientoModelos.class);

    private final RepositorioPrediccion repositorio;
    private final ModelosActivos modelos;
    private final CatalogoLocales locales;
    private final ModulosLocal modulos;
    private final ApplicationEventPublisher eventos;
    private final Clock reloj;

    EntrenamientoModelos(RepositorioPrediccion repositorio, ModelosActivos modelos, CatalogoLocales locales, ModulosLocal modulos,
                         ApplicationEventPublisher eventos, Clock reloj) {
        this.repositorio = repositorio;
        this.modelos = modelos;
        this.locales = locales;
        this.modulos = modulos;
        this.eventos = eventos;
        this.reloj = reloj;
    }

    public record Resultado(int colaId, Tipo elegido, int version, int nServicios, List<Tipo> permitidos, Double maeAntesMin, double maeDespuesMin,
                            long duracionMs) {
    }

    public Resultado reentrenarCola(int colaId) {
        long t0 = System.nanoTime();
        Instant ahora = reloj.instant();
        var cola = repositorio.cola(colaId).orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        Local local = locales.exigir(cola.localId());
        var cfg = repositorio.config(cola.localId());
        var desde = Fechas.fechaLocal(local.zonaHoraria(), ahora).minusDays(cfg.diasEntrenamiento());
        List<MuestraTurno> muestras = repositorio.muestras(colaId, desde).stream().map(m -> {
            var p = Fechas.partes(local.zonaHoraria(), m.emitidoAt());
            return new MuestraTurno(m.id(), m.emitidoAt().toEpochMilli(), m.llamadoAt() == null ? null : m.llamadoAt().toEpochMilli(),
                    m.finalizadoAt() == null ? null : m.finalizadoAt().toEpochMilli(), m.atendido(), m.delante() == null ? 0 : m.delante(),
                    Math.max(1, m.c() == null ? 1 : m.c()), p.diaSemana(), p.hora() * 2 + p.minuto() / 30);
        }).toList();
        int nServicios = (int) muestras.stream().filter(m -> m.atendido() && m.llamadoMs() != null && m.finalizadoMs() != null).count();
        long primera = muestras.isEmpty() ? ahora.toEpochMilli() : muestras.getFirst().emitidoMs();
        double diasHistoria = (ahora.toEpochMilli() - primera) / 86_400_000.0;
        List<Tipo> permitidos = ModelosEspera.elegibles(nServicios, diasHistoria);

        Map<Tipo, Entrenamiento> resultados = new EnumMap<>(Tipo.class);
        for (Tipo tipo : ModelosEspera.TIPOS) {
            resultados.put(tipo, ModelosEspera.entrenar(tipo, muestras, cola.tiempoAtencionBase(), cfg.alfaEma(), cfg.nivelConfianza(), ahora.toEpochMilli()));
        }
        var anterior = repositorio.activo(colaId);
        Tipo forzado = !"AUTO".equals(cfg.modelo()) && permitidos.contains(Tipo.valueOf(cfg.modelo())) ? Tipo.valueOf(cfg.modelo()) : null;
        Tipo elegido = forzado != null ? forzado
                : ModelosEspera.elegirModelo(ModelosEspera.maes(resultados), anterior.map(ModeloFila::tipo).orElse(null), permitidos);

        int version = repositorio.ultimaVersion(colaId) + 1;
        List<RepositorioPrediccion.NuevoModelo> filas = new ArrayList<>();
        for (Tipo tipo : ModelosEspera.TIPOS) {
            Entrenamiento r = resultados.get(tipo);
            filas.add(new RepositorioPrediccion.NuevoModelo(tipo, r.estado(), r.metricas(),
                    ModelosEspera.importanciaPermutacion(r.estado(), r.pares(), 2026)));
        }
        repositorio.guardarEntrenamiento(cola.localId(), colaId, version, filas, elegido);
        modelos.invalidar(colaId);
        long ms = Duration.ofNanos(System.nanoTime() - t0).toMillis();
        double maeDespues = resultados.get(elegido).metricas().mae();
        log.info("M2: modelo reentrenado local={} cola={} elegido={} n={} mae={}s en {} ms", cola.localId(), colaId, elegido, nServicios,
                Math.round(maeDespues), ms);
        Double maeAntes = anterior.map(ModeloFila::mae).map(x -> x / 60).orElse(null);
        return new Resultado(colaId, elegido, version, nServicios, permitidos, maeAntes, maeDespues / 60, ms);
    }

    public List<Resultado> reentrenarLocal(int localId, Integer colaId) {
        return repositorio.colasActivas(localId, colaId).stream().map(this::reentrenarCola).toList();
    }

    /** Job nocturno: reentrena todas las colas de los locales con M2. */
    public Map<String, Object> jobReentrenar() {
        int colas = 0;
        for (Local l : locales.activos()) {
            if (modulos.activo(l.id(), Modulo.M2)) {
                colas += reentrenarLocal(l.id(), null).size();
            }
        }
        return Map.of("colas", colas);
    }

    /** RN-M2-05: deriva en producción ⇒ BASELINE hasta el próximo reentrenamiento + alerta (M7). */
    public Map<String, Object> jobDeriva() {
        Instant ahora = reloj.instant();
        int derivas = 0;
        for (ModeloFila m : repositorio.activosVigilables()) {
            if (!modulos.activo(m.localId(), Modulo.M2)) {
                continue;
            }
            var logs = repositorio.serie(m.colaId(), ahora.minus(Duration.ofDays(7)), Integer.MAX_VALUE);
            double maeProd = Estadistica.media(logs.stream().map(l -> (double) Math.abs(l.predSeg() - (l.realSeg() == null ? 0 : l.realSeg()))).toList());
            double maeVal = m.mae() == null ? 0 : m.mae();
            if (!ModelosEspera.hayDeriva(maeProd, maeVal, logs.size())) {
                continue;
            }
            derivas++;
            repositorio.volverABase(m);
            modelos.invalidar(m.colaId());
            log.warn("M2: deriva en la cola {} (MAE producción {} s vs validación {} s): vuelve a BASELINE", m.colaId(), Math.round(maeProd), Math.round(maeVal));
            eventos.publishEvent(new DerivaDetectada(m.localId(), m.colaId(), m.tipo().name(), Math.round(maeProd / 6) / 10.0, Math.round(maeVal / 6) / 10.0));
        }
        return Map.of("derivas", derivas);
    }

    public record Metricas(Activo activo, List<ModeloInfo> modelos, Produccion produccion, List<Punto> serie) {
    }

    public record Activo(Tipo tipo, int version, Instant entrenadoAt, boolean deriva) {
    }

    public record ModeloInfo(Tipo tipo, boolean activo, int n, Double maeMin, Double medaeMin, Double acierto5, Double sesgoMin, Double cobertura,
                             Double anchoMin, List<ModelosEspera.Importancia> importancia, Instant entrenadoAt) {
    }

    public record Produccion(int n, double maeMin, double cobertura) {
    }

    public record Punto(Instant t, double pred, double lo, double hi, double real) {
    }

    /** GET /prediccion/metricas: por cola, métricas por modelo, serie real vs predicho, importancia y deriva. */
    public Metricas metricas(int localId, int colaId, int dias) {
        var cola = repositorio.cola(colaId).filter(c -> c.localId() == localId)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        int ultima = repositorio.ultimaVersion(cola.id());
        List<ModeloFila> deVersion = ultima == 0 ? List.of() : repositorio.modelosDeVersion(colaId, ultima);
        var activo = repositorio.activo(colaId);
        var serie = repositorio.serie(colaId, reloj.instant().minus(Duration.ofDays(dias)), 400);
        boolean deriva = deVersion.stream().anyMatch(ModeloFila::deriva);
        Produccion produccion = null;
        if (!serie.isEmpty()) {
            double mae = Estadistica.media(serie.stream().map(s -> (double) Math.abs(s.predSeg() - s.realSeg())).toList()) / 60;
            double cobertura = serie.stream().filter(s -> s.realSeg() >= s.loSeg() && s.realSeg() <= s.hiSeg()).count() / (double) serie.size();
            produccion = new Produccion(serie.size(), mae, cobertura);
        }
        return new Metricas(
                activo.map(a -> new Activo(a.tipo(), a.version(), a.entrenadoAt(), deriva)).orElse(null),
                deVersion.stream().map(m -> new ModeloInfo(m.tipo(), activo.map(a -> a.id() == m.id()).orElse(false), m.nMuestras(), minutos(m.mae()),
                        minutos(m.medae()), m.acierto5(), minutos(m.sesgo()), m.cobertura(), minutos(m.anchoMedio()), m.importancia(),
                        m.entrenadoAt())).toList(),
                produccion,
                serie.stream().map(s -> new Punto(s.creado(), decimo(s.predSeg()), decimo(s.loSeg()), decimo(s.hiSeg()), decimo(s.realSeg()))).toList());
    }

    private static Double minutos(Double seg) {
        return seg == null ? null : seg / 60;
    }

    private static double decimo(int seg) {
        return Math.round(seg / 6.0) / 10.0;
    }
}
