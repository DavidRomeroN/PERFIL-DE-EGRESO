package pe.turnoya.analitica.alertas;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import pe.turnoya.analitica.dominio.ReglasAnalitica;
import pe.turnoya.analitica.dominio.ReglasAnalitica.Nivel;
import pe.turnoya.analitica.dominio.RepositorioAnalitica;
import pe.turnoya.analitica.dominio.RepositorioAnalitica.Alerta;
import pe.turnoya.analitica.dominio.RepositorioAnalitica.ReglaAlerta;
import pe.turnoya.analitica.tablero.ConsultasAnalitica;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.eventos.EventoPantalla;
import pe.turnoya.compartido.seguridad.Telefonos;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.notificaciones.AvisosAlCliente;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * §6.5–6.6 Motor de alertas: mide cada regla del local (cada minuto, con candado por local), avanza la máquina de
 * estados (anti-flapping, autorresolución, escalamiento por niveles) y notifica por los canales de cada nivel.
 * Las alertas de sistema (deriva de M2, límite de M6) entran por evento con {@link #deSistema}.
 */
@Service
public class MotorAlertas {

    private static final Logger log = LoggerFactory.getLogger(MotorAlertas.class);

    public static final Map<String, String> TIPOS = new LinkedHashMap<>();

    static {
        TIPOS.put("ESPERA_ALTA", "Espera alta");
        TIPOS.put("COLA_LARGA", "Cola larga");
        TIPOS.put("SLA_INCUMPLIDO", "SLA incumplido");
        TIPOS.put("ANOMALIA_LLEGADAS", "Afluencia inusual");
        TIPOS.put("VENTANILLA_INACTIVA", "Ventanilla inactiva");
        TIPOS.put("WHATSAPP_CAIDO", "WhatsApp caído");
        TIPOS.put("KIOSCO_OFFLINE", "Kiosco sin conexión");
        TIPOS.put("PREDICCION_DERIVA", "Deriva del modelo de espera");
        TIPOS.put("BALANCEO_LIMITE", "Límite del balanceo");
        TIPOS.put("JOB_FALLIDO", "Tarea fallida");
    }

    static final Set<String> TIPOS_MEDIDOS = Set.of("SLA_INCUMPLIDO", "ESPERA_ALTA", "COLA_LARGA", "ANOMALIA_LLEGADAS", "VENTANILLA_INACTIVA",
            "WHATSAPP_CAIDO", "KIOSCO_OFFLINE");

    private record PorDefecto(String tipo, String nombre, Map<String, Object> umbral) {
    }

    private static final List<PorDefecto> REGLAS_POR_DEFECTO = List.of(
            new PorDefecto("ESPERA_ALTA", "Espera máxima mayor a 20 min", Map.of("esperaMaxMin", 20)),
            new PorDefecto("COLA_LARGA", "Más de 25 personas esperando", Map.of("enEspera", 25)),
            new PorDefecto("SLA_INCUMPLIDO", "SLA por debajo del objetivo", Map.of()),
            new PorDefecto("ANOMALIA_LLEGADAS", "Afluencia inusual", Map.of("z", 3.5)),
            new PorDefecto("VENTANILLA_INACTIVA", "Ventanilla sin llamar con gente esperando", Map.of("minutos", 10)),
            new PorDefecto("WHATSAPP_CAIDO", "WhatsApp sin poder enviar", Map.of("fallosSeguidos", 3)),
            new PorDefecto("KIOSCO_OFFLINE", "Kiosco sin conexión", Map.of("segundos", 75)));

    private final RepositorioAnalitica repositorio;
    private final ConsultasAnalitica consultas;
    private final CatalogoLocales locales;
    private final ModulosLocal modulos;
    private final AvisosAlCliente avisos;
    private final ApplicationEventPublisher eventos;
    private final MeterRegistry medidor;
    private final ObjectMapper json;
    private final Clock reloj;
    private final TransactionTemplate transaccion;

    MotorAlertas(RepositorioAnalitica repositorio, ConsultasAnalitica consultas, CatalogoLocales locales, ModulosLocal modulos, AvisosAlCliente avisos,
                 ApplicationEventPublisher eventos, MeterRegistry medidor, ObjectMapper json, Clock reloj, PlatformTransactionManager tx) {
        this.repositorio = repositorio;
        this.consultas = consultas;
        this.locales = locales;
        this.modulos = modulos;
        this.avisos = avisos;
        this.eventos = eventos;
        this.medidor = medidor;
        this.json = json;
        this.reloj = reloj;
        this.transaccion = new TransactionTemplate(tx);
        this.transaccion.setTimeout(60);
    }

    /** Siembra las reglas por defecto la primera vez que el local usa M7. */
    @Transactional
    public void sembrar(int localId) {
        if (repositorio.contarReglas(localId) > 0) {
            return;
        }
        String niveles = json.writeValueAsString(ReglasAnalitica.NIVELES_POR_DEFECTO);
        for (var r : REGLAS_POR_DEFECTO) {
            repositorio.crearRegla(localId, r.tipo(), r.nombre(), json.writeValueAsString(r.umbral()), niveles, 10);
        }
    }

    // --- Evaluación ---

    private record Observacion(String entidad, boolean dispara, String titulo, Map<String, Object> detalle) {
    }

    /** Job {@code alertas-evaluar}: cada local con M7, en su propia transacción con candado consultivo. */
    public String job() {
        int evaluados = 0;
        for (int localId : repositorio.localesActivos()) {
            if (!modulos.activo(localId, Modulo.M7)) {
                continue;
            }
            try {
                Boolean ok = transaccion.execute(s -> {
                    if (!repositorio.candado(localId)) {
                        return false;
                    }
                    evaluarLocal(localId);
                    return true;
                });
                if (Boolean.TRUE.equals(ok)) {
                    evaluados++;
                }
            } catch (RuntimeException e) {
                log.warn("Evaluación de alertas del local {} falló: {}", localId, e.getMessage());
            }
        }
        return "evaluados=" + evaluados;
    }

    /** Job {@code analitica-limpiar}: alertas resueltas de más de 180 días. */
    public String limpiar() {
        return "alertas=" + repositorio.borrarResueltasAntes(reloj.instant().minus(Duration.ofDays(180)));
    }

    void evaluarLocal(int localId) {
        long t0 = System.nanoTime();
        Local local = locales.exigir(localId);
        sembrar(localId);
        Instant ahora = reloj.instant();
        for (ReglaAlerta regla : repositorio.reglas(localId)) {
            if (!regla.activa() || !TIPOS_MEDIDOS.contains(regla.tipo()) || (regla.silenciadaHasta() != null && regla.silenciadaHasta().isAfter(ahora))) {
                continue;
            }
            List<Observacion> obs;
            try {
                obs = medir(regla, local, ahora);
            } catch (RuntimeException e) {
                log.warn("No se pudo medir la regla de alerta {} del local {}: {}", regla.id(), localId, e.getMessage());
                continue;
            }
            for (Observacion o : obs) {
                aplicar(regla, localId, o, ahora);
            }
        }
        // Alertas de sistema por evento: se resuelven solas tras 60 min sin repetirse
        for (Alerta a : repositorio.deSistemaSinRepetir(localId, ahora.minus(Duration.ofMinutes(60)))) {
            repositorio.resolver(a.id(), ahora);
            emitir("alerta:actualizada", localId, a.id(), a.titulo(), a.nivel(), "RESUELTA");
        }
        medidor.timer("m7_eval_ms").record(Duration.ofNanos(System.nanoTime() - t0));
    }

    private Map<String, Double> umbral(ReglaAlerta r) {
        try {
            Map<String, Object> m = json.readValue(r.umbralJson(), new TypeReference<Map<String, Object>>() {
            });
            Map<String, Double> salida = new LinkedHashMap<>();
            m.forEach((k, v) -> {
                if (v instanceof Number n) {
                    salida.put(k, n.doubleValue());
                }
            });
            return salida;
        } catch (RuntimeException e) {
            return Map.of();
        }
    }

    private List<Nivel> niveles(ReglaAlerta r) {
        try {
            List<Nivel> n = json.readValue(r.nivelesJson(), new TypeReference<List<Nivel>>() {
            });
            return n == null || n.isEmpty() ? ReglasAnalitica.NIVELES_POR_DEFECTO : n;
        } catch (RuntimeException e) {
            return ReglasAnalitica.NIVELES_POR_DEFECTO;
        }
    }

    private List<Observacion> medir(ReglaAlerta regla, Local local, Instant ahora) {
        Map<String, Double> u = umbral(regla);
        Integer colaId = u.get("colaId") == null ? null : u.get("colaId").intValue();
        LocalDate fecha = Fechas.fechaLocal(local.zonaHoraria(), ahora);
        List<Observacion> out = new ArrayList<>();
        switch (regla.tipo()) {
            case "ESPERA_ALTA" -> {
                double lim = u.getOrDefault("esperaMaxMin", 20.0);
                for (var c : repositorio.colasActivas(local.id(), colaId)) {
                    double min = repositorio.masAntiguoEnEspera(c.id(), fecha).map(t -> Duration.between(t, ahora).toSeconds() / 60.0).orElse(0.0);
                    out.add(new Observacion("cola:" + c.id(), min > lim, "Espera alta en " + c.nombre(),
                            detalle("esperaMaxMin", Math.round(min), "umbral", lim)));
                }
            }
            case "COLA_LARGA" -> {
                double lim = u.getOrDefault("enEspera", 25.0);
                for (var c : repositorio.colasActivas(local.id(), colaId)) {
                    int n = repositorio.enEspera(c.id(), fecha);
                    out.add(new Observacion("cola:" + c.id(), n > lim, "Cola larga en " + c.nombre(), detalle("enEspera", n, "umbral", lim)));
                }
            }
            case "SLA_INCUMPLIDO" -> {
                for (var s : consultas.estadoSla(local.id())) {
                    if (!s.configurado() || (colaId != null && s.colaId() != colaId)) {
                        continue;
                    }
                    boolean dispara = s.muestra() >= 10 && s.cumplimiento() != null && s.cumplimiento() * 100 < s.objetivoPct();
                    out.add(new Observacion("cola:" + s.colaId(), dispara, "SLA incumplido en " + s.cola(),
                            detalle("cumplimientoPct", s.cumplimientoPct(), "objetivoPct", s.objetivoPct(), "muestra", s.muestra())));
                }
            }
            case "ANOMALIA_LLEGADAS" -> {
                var p = Fechas.partes(local.zonaHoraria(), ahora);
                int franja = p.hora() * 2 + p.minuto() / 30;
                double fraccion = (p.minuto() % 30) / 30.0;
                if (fraccion == 0) {
                    fraccion = 1;
                }
                Instant inicioFranja = ahora.truncatedTo(ChronoUnit.MINUTES).minus(Duration.ofMinutes(p.minuto() % 30));
                for (var c : repositorio.colasActivas(local.id(), colaId)) {
                    List<Double> valores = new ArrayList<>(repositorio.llegadasHistoricas(c.id(), p.diaSemana(), franja, fecha.minusDays(56), fecha).stream()
                            .map(Integer::doubleValue).toList());
                    int semanas = valores.size();
                    // Las semanas sin llegadas en esa franja también son observaciones (0)
                    while (valores.size() < 8 && valores.size() >= 4) {
                        valores.add(0.0);
                    }
                    int observado = repositorio.llegadasDesde(c.id(), inicioFranja);
                    Double z = ReglasAnalitica.zRobusto(valores, observado, fraccion);
                    out.add(new Observacion("cola:" + c.id(), ReglasAnalitica.esAnomalia(z, u.getOrDefault("z", 3.5)),
                            z != null && z > 0 ? "Afluencia inusualmente alta en " + c.nombre() : "Caída de afluencia en " + c.nombre(),
                            detalle("z", z == null ? null : Math.round(z * 10) / 10.0, "observado", observado, "semanas", semanas)));
                }
            }
            case "VENTANILLA_INACTIVA" -> {
                double lim = u.getOrDefault("minutos", 10.0);
                for (var v : repositorio.ventanillasActivas(local.id())) {
                    var uso = repositorio.ultimoUso(v.id(), fecha).orElse(null);
                    if (uso == null) {
                        continue; // sin operador hoy: no se considera
                    }
                    int espera = repositorio.enEsperaDelLocal(local.id(), fecha, v.colaId());
                    double inactiva = uso.llamadoAt() == null ? 0 : Duration.between(uso.llamadoAt(), ahora).toSeconds() / 60.0;
                    out.add(new Observacion("ventanilla:" + v.id(), espera > 0 && !"LLAMADO".equals(uso.estado()) && inactiva > lim, v.nombre() + " sin llamar",
                            detalle("minutos", Math.round(inactiva), "enEspera", espera)));
                }
            }
            case "WHATSAPP_CAIDO" -> {
                int n = u.getOrDefault("fallosSeguidos", 3.0).intValue();
                var ult = repositorio.ultimosEstadosWhatsapp(local.id(), n);
                long fallidos = ult.stream().filter("FALLIDO"::equals).count();
                out.add(new Observacion("whatsapp", ult.size() >= n && fallidos == ult.size(), "WhatsApp no está enviando", detalle("fallosSeguidos", fallidos)));
            }
            case "KIOSCO_OFFLINE" -> {
                double seg = u.getOrDefault("segundos", 75.0);
                for (var k : repositorio.kioscosEmparejados(local.id())) {
                    Long hace = k.ultimoHeartbeatAt() == null ? null : Duration.between(k.ultimoHeartbeatAt(), ahora).toSeconds();
                    out.add(new Observacion("kiosco:" + k.id(), hace == null || hace > seg, "Kiosco K" + k.numero() + " (" + k.nombre() + ") sin conexión",
                            detalle("segundosSinSenal", hace)));
                }
            }
            default -> {
            }
        }
        return out;
    }

    private static Map<String, Object> detalle(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            m.put((String) kv[i], kv[i + 1]);
        }
        return m;
    }

    private void aplicar(ReglaAlerta regla, int localId, Observacion o, Instant ahora) {
        String h = ReglasAnalitica.huella(regla.tipo(), localId, o.entidad());
        var rachaFila = repositorio.racha(h).orElse(null);
        Alerta viva = repositorio.alertaViva(h).orElse(null);
        Alerta ultima = viva != null ? viva : repositorio.ultimaResuelta(h).orElse(null);
        List<Nivel> niveles = niveles(regla);
        var paso = ReglasAnalitica.avanzarAlerta(o.dispara(), ahora.toEpochMilli(),
                new ReglasAnalitica.Racha(rachaFila == null ? 0 : rachaFila.disparos(), rachaFila == null || rachaFila.normalDesde() == null ? null
                        : rachaFila.normalDesde().toEpochMilli()),
                ultima == null ? null : new ReglasAnalitica.AlertaViva(ultima.estado(), ultima.nivel(), ultima.primeraVezAt().toEpochMilli(), ms(ultima.proximoEscalaAt()),
                        ms(ultima.silenciadaHasta()), ms(ultima.resueltaAt())),
                niveles, regla.resolverTrasMin());
        repositorio.guardarRacha(h, localId, paso.racha().disparos(), instante(paso.racha().normalDesdeMs()), ahora);
        String detalle = json.writeValueAsString(o.detalle());
        var d = paso.decision();
        switch (d.tipo()) {
            case ABRIR -> repositorio.abrir(localId, regla.id(), regla.tipo(), h, o.entidad(), o.titulo(), detalle, ahora, instante(d.proximoEscalaMs()))
                    .ifPresent(id -> {
                        medidor.counter("m7_alertas_total", "tipo", regla.tipo(), "nivel", "1").increment();
                        emitir("alerta:nueva", localId, id, o.titulo(), 1, "ABIERTA");
                        notificar(localId, id, o.titulo(), o.detalle(), niveles, 1);
                    });
            case REABRIR -> {
                if (ultima != null) {
                    repositorio.reabrir(ultima.id(), ahora, detalle, instante(d.proximoEscalaMs()));
                    emitir("alerta:actualizada", localId, ultima.id(), ultima.titulo(), ultima.nivel(), "ABIERTA");
                }
            }
            case REPETIR -> {
                if (viva != null) {
                    repositorio.repetir(viva.id(), ahora, detalle);
                }
            }
            case ESCALAR -> {
                if (viva != null) {
                    repositorio.escalar(viva.id(), d.nivel(), instante(d.proximoEscalaMs()), ahora);
                    medidor.counter("m7_alertas_total", "tipo", regla.tipo(), "nivel", String.valueOf(d.nivel())).increment();
                    emitir("alerta:actualizada", localId, viva.id(), viva.titulo(), d.nivel(), viva.estado());
                    notificar(localId, viva.id(), viva.titulo(), o.detalle(), niveles, d.nivel());
                }
            }
            case DESILENCIAR -> {
                if (viva != null) {
                    repositorio.desilenciar(viva.id(), ahora);
                    emitir("alerta:actualizada", localId, viva.id(), viva.titulo(), viva.nivel(), "ABIERTA");
                }
            }
            case RESOLVER -> {
                if (viva != null) {
                    repositorio.resolver(viva.id(), ahora);
                    emitir("alerta:actualizada", localId, viva.id(), viva.titulo(), viva.nivel(), "RESUELTA");
                }
            }
            case NADA -> {
            }
        }
    }

    private void emitir(String tipo, int localId, long id, String titulo, int nivel, String estado) {
        eventos.publishEvent(new EventoPantalla(tipo, localId, Map.of("alerta", Map.of("id", String.valueOf(id), "titulo", titulo, "nivel", nivel, "estado", estado))));
    }

    /** Notifica por los canales del nivel; ≤ 1 por (alerta, nivel, canal) por hora (RN-M7-05). */
    private void notificar(int localId, long alertaId, String titulo, Map<String, Object> detalle, List<Nivel> niveles, int nivel) {
        if (nivel < 1 || nivel > niveles.size()) {
            return;
        }
        Local local = locales.exigir(localId);
        Instant hora = reloj.instant().truncatedTo(ChronoUnit.HOURS);
        StringBuilder texto = new StringBuilder("🔔 [TurnoYa · ").append(local.nombreComercial()).append("] ").append(titulo).append(" (nivel ").append(nivel)
                .append(").");
        detalle.forEach((k, v) -> texto.append(' ').append(k).append(": ").append(v).append(','));
        String mensaje = texto.toString().replaceAll(",$", "");
        for (String canal : niveles.get(nivel - 1).canales()) {
            if (!repositorio.registrarNotificacion(alertaId, nivel, canal, hora)) {
                continue;
            }
            String estado;
            String destino = null;
            switch (canal) {
                case "WHATSAPP" -> {
                    var tel = local.telefono() == null ? java.util.Optional.<String>empty() : Telefonos.normalizar(local.telefono());
                    if (tel.isPresent()) {
                        destino = Telefonos.enmascarar(tel.get());
                        try {
                            estado = "WHATSAPP".equals(avisos.alLocal(localId, tel.get(), "alerta", mensaje)) ? "ENVIADO" : "WEB";
                        } catch (RuntimeException e) {
                            estado = "FALLIDO";
                        }
                    } else {
                        estado = "SIN_DESTINO";
                    }
                }
                // Sin servicio de correo configurado en esta versión: queda registrado y visible en la app
                case "CORREO" -> estado = "NO_ENVIADO: sin servicio de correo";
                default -> estado = "ENVIADO";
            }
            repositorio.actualizarNotificacion(alertaId, nivel, canal, hora, estado, destino);
            medidor.counter("m7_notificaciones_total", "canal", canal, "resultado", estado.startsWith("ENVIADO") ? "ok" : "no").increment();
        }
    }

    /** Alerta de sistema disparada por evento (deriva de M2, límite o aviso de M6). Sin M7 activo no hace nada. */
    @Transactional
    public void deSistema(int localId, String tipo, String entidad, String titulo, Map<String, Object> detalle) {
        if (!modulos.activo(localId, Modulo.M7)) {
            return;
        }
        Instant ahora = reloj.instant();
        String h = ReglasAnalitica.huella(tipo, localId, entidad);
        String det = json.writeValueAsString(detalle);
        var viva = repositorio.alertaViva(h);
        if (viva.isPresent()) {
            repositorio.repetir(viva.get().id(), ahora, det);
            return;
        }
        repositorio.abrir(localId, null, tipo, h, entidad, titulo, det, ahora, ahora.plus(Duration.ofMinutes(10))).ifPresent(id -> {
            emitir("alerta:nueva", localId, id, titulo, 1, "ABIERTA");
            notificar(localId, id, titulo, detalle, ReglasAnalitica.NIVELES_POR_DEFECTO, 1);
        });
    }

    // --- Acciones del admin (RF-M7-07) ---

    @Transactional
    public Alerta accion(int localId, long id, String accion, Integer usuarioId, Instant hasta) {
        modulos.exigir(localId, Modulo.M7);
        Alerta a = repositorio.alerta(id, localId).orElseThrow(() -> ErrorNegocio.noEncontrado("M7_ALERTA_NO_ENCONTRADA", "La alerta no existe"));
        Instant ahora = reloj.instant();
        switch (accion == null ? "" : accion) {
            case "RECONOCER" -> {
                if (!"ABIERTA".equals(a.estado())) {
                    throw invalido("Solo se reconoce una alerta abierta");
                }
                repositorio.reconocer(id, usuarioId, ahora);
            }
            case "RESOLVER" -> {
                if ("RESUELTA".equals(a.estado())) {
                    throw invalido("La alerta ya está resuelta");
                }
                repositorio.resolver(id, ahora);
            }
            case "SILENCIAR" -> {
                if (hasta == null || !hasta.isAfter(ahora)) {
                    throw new ErrorNegocio("VALIDACION", "Indica hasta cuándo silenciar", 422);
                }
                if ("RESUELTA".equals(a.estado())) {
                    throw invalido("La alerta ya está resuelta");
                }
                repositorio.silenciar(id, hasta);
            }
            case "REABRIR" -> {
                if (!"RESUELTA".equals(a.estado())) {
                    throw invalido("Solo se reabre una alerta resuelta");
                }
                if (repositorio.alertaViva(a.huella()).isPresent()) {
                    throw invalido("Ya hay otra alerta viva para el mismo problema");
                }
                repositorio.reabrirManual(id, ahora);
            }
            default -> throw new ErrorNegocio("VALIDACION", "Acción inválida", 422);
        }
        Alerta r = repositorio.alerta(id, localId).orElseThrow();
        emitir("alerta:actualizada", localId, r.id(), r.titulo(), r.nivel(), r.estado());
        return r;
    }

    private static ErrorNegocio invalido(String mensaje) {
        return new ErrorNegocio("M7_ESTADO_INVALIDO", mensaje, 409);
    }

    // --- Consultas para la API y la página ---

    public record VistaAlerta(String id, String tipo, String nombreTipo, String titulo, int nivel, String estado, Map<String, Object> detalle, int ocurrencias,
                              Instant primeraVezAt, Instant ultimaVezAt, Instant reconocidaAt, Instant resueltaAt, Instant silenciadaHasta) {

        public String textoDetalle() {
            if (detalle == null) {
                return "";
            }
            return String.join(" · ", detalle.entrySet().stream().map(e -> e.getKey() + ": " + e.getValue()).toList());
        }
    }

    public record Pagina(List<VistaAlerta> items, String cursor) {
    }

    public Pagina listar(int localId, List<String> estados, String tipo, Long cursor) {
        modulos.exigir(localId, Modulo.M7);
        var filas = repositorio.alertas(localId, estados, tipo == null || tipo.isBlank() ? null : tipo, cursor, 50);
        return new Pagina(filas.stream().map(this::vista).toList(), filas.size() == 50 ? String.valueOf(filas.getLast().id()) : null);
    }

    public VistaAlerta vista(Alerta a) {
        Map<String, Object> det;
        try {
            det = json.readValue(a.detalleJson(), new TypeReference<Map<String, Object>>() {
            });
        } catch (RuntimeException e) {
            det = Map.of();
        }
        return new VistaAlerta(String.valueOf(a.id()), a.tipo(), TIPOS.getOrDefault(a.tipo(), a.tipo()), a.titulo(), a.nivel(), a.estado(), det, a.ocurrencias(),
                a.primeraVezAt(), a.ultimaVezAt(), a.reconocidaAt(), a.resueltaAt(), a.silenciadaHasta());
    }

    public record Ultima(String id, String titulo, int nivel, String estado, Instant ultimaVezAt) {
    }

    public record Resumen(boolean activo, int abiertas, List<Ultima> ultimas) {
    }

    /** Contador para la campana (no exige M7: devuelve 0 si está apagado). */
    public Resumen resumen(int localId) {
        if (!modulos.activo(localId, Modulo.M7)) {
            return new Resumen(false, 0, List.of());
        }
        var ultimas = repositorio.alertas(localId, List.of("ABIERTA", "RECONOCIDA"), null, null, 5).stream()
                .map(a -> new Ultima(String.valueOf(a.id()), a.titulo(), a.nivel(), a.estado(), a.ultimaVezAt())).toList();
        return new Resumen(true, repositorio.contarAbiertas(localId), ultimas);
    }

    private static Long ms(Instant i) {
        return i == null ? null : i.toEpochMilli();
    }

    private static Instant instante(Long ms) {
        return ms == null ? null : Instant.ofEpochMilli(ms);
    }
}
