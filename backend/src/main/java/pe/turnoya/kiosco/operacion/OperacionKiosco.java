package pe.turnoya.kiosco.operacion;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import pe.turnoya.citas.CheckinPresencial;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.eventos.EventoPantalla;
import pe.turnoya.compartido.seguridad.CifradoDatos;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.kiosco.KioscoSinConexion;
import pe.turnoya.kiosco.dispositivos.GestionKioscos;
import pe.turnoya.kiosco.dominio.ReglasKiosco;
import pe.turnoya.kiosco.dominio.RepositorioKiosco;
import pe.turnoya.kiosco.dominio.RepositorioKiosco.Dispositivo;
import pe.turnoya.kiosco.dominio.RepositorioKiosco.Evento;
import pe.turnoya.kiosco.dominio.RepositorioKiosco.TurnoBreve;
import pe.turnoya.nucleo.TomaDeTurnos;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import tools.jackson.databind.ObjectMapper;

/** M5 · Lado del dispositivo: emparejamiento, autenticación, configuración, latido, emisión idempotente y sincronización (§6.4). */
@Service
public class OperacionKiosco {

    private static final Logger LOG = LoggerFactory.getLogger(OperacionKiosco.class);
    private static final SecureRandom AZAR = new SecureRandom();
    private static final List<String> A_REVISION = List.of("LIMITE_PLAN", "COLA_INACTIVA", "COLA_CERRADA", "M1_CATEGORIA_INVALIDA",
            "M1_CATEGORIA_NO_DISPONIBLE", "TELEFONO_INVALIDO", "CONSENTIMIENTO_REQUERIDO", "LOCAL_CERRADO", "FUERA_DE_HORARIO");

    private final RepositorioKiosco repositorio;
    private final TomaDeTurnos tomaDeTurnos;
    private final CheckinPresencial citas;
    private final CatalogoLocales locales;
    private final ModulosLocal modulos;
    private final CifradoDatos cifrado;
    private final ApplicationEventPublisher eventos;
    private final ObjectMapper json;
    private final Clock reloj;
    private final int ventanaOfflineHoras;

    OperacionKiosco(RepositorioKiosco repositorio, TomaDeTurnos tomaDeTurnos, CheckinPresencial citas, CatalogoLocales locales, ModulosLocal modulos,
                    CifradoDatos cifrado, ApplicationEventPublisher eventos, ObjectMapper json, Clock reloj,
                    @Value("${turnoya.kiosco.ventana-offline-horas:12}") int ventanaOfflineHoras) {
        this.repositorio = repositorio;
        this.tomaDeTurnos = tomaDeTurnos;
        this.citas = citas;
        this.locales = locales;
        this.modulos = modulos;
        this.cifrado = cifrado;
        this.eventos = eventos;
        this.json = json;
        this.reloj = reloj;
        this.ventanaOfflineHoras = ventanaOfflineHoras;
    }

    // --- Autenticación (token Bearer, solo /api/v1/kiosco/*) ---

    public Dispositivo autenticar(String authorization) {
        String token = authorization != null && authorization.startsWith("Bearer ") ? authorization.substring(7).trim() : "";
        if (token.length() < 20) {
            throw new ErrorNegocio("M5_DISPOSITIVO_NO_AUTORIZADO", "Dispositivo no autorizado", 401);
        }
        Dispositivo d = repositorio.porToken(GestionKioscos.sha(token))
                .orElseThrow(() -> new ErrorNegocio("M5_DISPOSITIVO_NO_AUTORIZADO", "Dispositivo no autorizado", 401));
        if (!modulos.activo(d.localId(), Modulo.M5)) {
            throw ErrorNegocio.prohibido("MODULO_NO_DISPONIBLE", "El kiosco no está activo en este local");
        }
        return d;
    }

    public record Emparejado(int dispositivoId, int numero, String token, Config config) {
    }

    /** Canjea el código de 6 dígitos por un token (32 bytes) del que solo se guarda el hash. */
    public Emparejado emparejar(String codigo) {
        String limpio = codigo == null ? "" : codigo.replaceAll("\\D", "");
        if (limpio.length() != 6) {
            throw ErrorNegocio.prohibido("M5_CODIGO_INVALIDO", "El código tiene 6 dígitos");
        }
        byte[] hash = GestionKioscos.sha(limpio).getBytes(StandardCharsets.UTF_8);
        Dispositivo d = repositorio.conCodigoVigente().stream()
                .filter(c -> MessageDigest.isEqual(c.codigoHash().getBytes(StandardCharsets.UTF_8), hash))
                .findFirst().orElseThrow(() -> ErrorNegocio.prohibido("M5_CODIGO_INVALIDO", "El código no es válido"));
        Instant ahora = reloj.instant();
        if (d.codigoExpira() == null || d.codigoExpira().isBefore(ahora)) {
            throw new ErrorNegocio("M5_CODIGO_EXPIRADO", "El código expiró; genera otro desde el admin", 410);
        }
        byte[] bytes = new byte[32];
        AZAR.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        repositorio.emparejar(d.id(), GestionKioscos.sha(token), ahora);
        LOG.info("kiosco emparejado local={} dispositivo={}", d.localId(), d.id());
        return new Emparejado(d.id(), d.numero(), token, config(d.id()));
    }

    public record ColaKiosco(int id, String nombre, String prefijo, String descripcion) {
    }

    public record CategoriaKiosco(String codigo, String nombre, String documento) {
    }

    public record DispositivoResumen(int id, int numero, String nombre) {
    }

    public record LocalKiosco(String nombre, String color, String logoUrl, String slug) {
    }

    public record Config(int version, DispositivoResumen dispositivo, LocalKiosco local, List<ColaKiosco> colas, List<CategoriaKiosco> categorias,
                         boolean citas, boolean abierto, String mensajeCerrado, int inactividadSeg, int ventanaOfflineHoras, Map<String, String> textos) {
    }

    public Config config(int dispositivoId) {
        Dispositivo d = repositorio.dispositivo(dispositivoId).orElseThrow();
        Local local = locales.exigir(d.localId());
        var abierto = tomaDeTurnos.local(local.slug());
        var colas = abierto.colas().stream().filter(c -> d.colaIds().isEmpty() || d.colaIds().contains(c.id()))
                .map(c -> new ColaKiosco(c.id(), c.nombre(), c.prefijo(), c.descripcion())).toList();
        var categorias = abierto.categorias().stream().filter(c -> !"GENERAL".equals(c.codigo()))
                .map(c -> new CategoriaKiosco(c.codigo(), c.nombre(), c.documento())).toList();
        return new Config(d.configVersion(), new DispositivoResumen(d.id(), d.numero(), d.nombre()),
                new LocalKiosco(local.nombreComercial(), local.colorPrimario(), local.logoUrl(), local.slug()), colas, categorias,
                modulos.activo(d.localId(), Modulo.M3), abierto.abierto(), abierto.mensajeCerrado(), 30, ventanaOfflineHoras,
                Map.of("consentimiento", "Al dejar tu celular aceptas que lo usemos solo para avisarte de tu turno (Ley 29733). Se borra a los 90 días."));
    }

    public record Latido(String serverTime, int configVersion, boolean relojDesfasado) {
    }

    /** Latido cada 20 s: guarda estado y desfase; responde la hora del servidor (§6.5). */
    public Latido latido(Dispositivo d, Integer pendientes, String version, String impresora, Double offsetMs) {
        Instant ahora = reloj.instant();
        Integer offset = offsetMs == null ? null : (int) Math.round(offsetMs);
        boolean volvio = repositorio.latido(d.id(), ahora, pendientes == null ? 0 : Math.max(0, pendientes), recortar(version, 20), recortar(impresora, 40), offset);
        if (volvio) {
            eventos.publishEvent(new EventoPantalla("kiosco:estado", d.localId(), Map.of("dispositivoId", d.id(), "enLinea", true)));
        }
        Dispositivo r = repositorio.dispositivo(d.id()).orElseThrow();
        return new Latido(ahora.toString(), r.configVersion(), Math.abs(r.offsetRelojMs()) > ReglasKiosco.DESFASE_ALERTA_MS);
    }

    public boolean pinValido(Dispositivo d, String pin) {
        return pin != null && d.pinHash() != null && MessageDigest.isEqual(d.pinHash().getBytes(StandardCharsets.UTF_8),
                GestionKioscos.sha(pin).getBytes(StandardCharsets.UTF_8));
    }

    // --- Emisión y sincronización ---

    public record Carga(Integer colaId, String categoria, String nombre, String telefono, Boolean consentimiento, String codigoCita) {
    }

    public record EventoEntrada(String claveIdem, Integer seq, String tipo, String tsDispositivo, Integer offsetMsAlEmitir, Carga payload) {
    }

    public record TurnoKiosco(String codigo, String token, Integer posicion) {
    }

    /** {@code estado}: APLICADO, DUPLICADO (con turno) o REVISION, RECHAZADO (con motivo). */
    public record Resultado(String claveIdem, String estado, TurnoKiosco turno, String motivo) {

        static Resultado conTurno(String clave, String estado, TurnoKiosco t) {
            return new Resultado(clave, estado, t, null);
        }

        static Resultado sinTurno(String clave, String estado, String motivo) {
            return new Resultado(clave, estado, null, motivo);
        }
    }

    /** Aplica un evento; idempotente por {@code claveIdem}. */
    public Resultado aplicar(Dispositivo disp, EventoEntrada ev) {
        String clave = ev.claveIdem();
        if (!ReglasKiosco.claveValida(clave) || ev.seq() == null || ev.seq() < 1 || ev.payload() == null) {
            return Resultado.sinTurno(clave, "RECHAZADO", "M5_EVENTO_INVALIDO");
        }
        Instant tsDisp;
        try {
            tsDisp = Instant.parse(ev.tsDispositivo());
        } catch (RuntimeException e) {
            return Resultado.sinTurno(clave, "RECHAZADO", "M5_EVENTO_INVALIDO");
        }
        Carga p = ev.payload();
        String tipo = "CHECKIN_CITA".equals(ev.tipo()) ? "CHECKIN_CITA" : "EMITIR_TURNO";
        int offset = ev.offsetMsAlEmitir() == null ? 0 : ev.offsetMsAlEmitir();
        Map<String, Object> seguro = new LinkedHashMap<>();
        seguro.put("colaId", p.colaId());
        seguro.put("categoria", p.categoria());
        seguro.put("codigoCita", p.codigoCita());
        seguro.put("consentimiento", Boolean.TRUE.equals(p.consentimiento()));
        if (p.nombre() != null && !p.nombre().isBlank()) {
            seguro.put("nombre", recortar(p.nombre().trim(), 60));
        }
        if (p.telefono() != null && !p.telefono().isBlank()) {
            seguro.put("telefonoCifrado", cifrado.cifrar(p.telefono().trim()));
        }
        if (!repositorio.insertarEvento(disp.id(), clave, ev.seq(), tipo, json.writeValueAsString(seguro), tsDisp, offset)) {
            Resultado previo = existente(clave);
            if (previo != null) {
                return previo;
            }
        }
        Evento fila = repositorio.evento(clave).orElseThrow();
        Instant ahora = reloj.instant();
        Long previoMs = repositorio.ultimoTsCorregido(disp.id(), fila.id()).map(Instant::toEpochMilli).orElse(null);
        Instant tsCorr = Instant.ofEpochMilli(ReglasKiosco.corregirTiempo(tsDisp.toEpochMilli(), offset, previoMs, ahora.toEpochMilli()));
        Local local = locales.exigir(disp.localId());
        String payloadSinDatos = json.writeValueAsString(Map.of("colaId", p.colaId() == null ? 0 : p.colaId(),
                "categoria", p.categoria() == null ? "" : p.categoria()));

        var motivo = ReglasKiosco.validarEvento(Fechas.fechaLocal(local.zonaHoraria(), tsCorr).toString(),
                Fechas.fechaLocal(local.zonaHoraria(), ahora).toString(), tsCorr.toEpochMilli(), ahora.toEpochMilli(), ventanaOfflineHoras, offset,
                disp.offsetRelojMs());
        if (motivo != null) {
            return revision(disp, fila, tsCorr, motivo.name());
        }

        if (tipo.equals("CHECKIN_CITA")) {
            try {
                var r = citas.porCodigo(disp.localId(), p.codigoCita());
                TurnoBreve t = repositorio.turnoPorToken(r.turnoToken()).orElseThrow();
                String estado = r.repetido() ? "DUPLICADO" : "APLICADO";
                repositorio.marcarEvento(fila.id(), estado, null, t.id(), tsCorr, payloadSinDatos);
                return Resultado.conTurno(clave, estado, new TurnoKiosco(t.codigo(), t.token(), null));
            } catch (ErrorNegocio e) {
                return revision(disp, fila, tsCorr, e.codigo());
            }
        }

        int colaId = p.colaId() == null ? 0 : p.colaId();
        if (!disp.colaIds().isEmpty() && !disp.colaIds().contains(colaId)) {
            return revision(disp, fila, tsCorr, "COLA_NO_ASIGNADA");
        }
        try {
            boolean tardio = Math.abs(ahora.toEpochMilli() - tsCorr.toEpochMilli()) > 60_000;
            var t = tomaDeTurnos.porKiosco(colaId, (String) seguro.get("nombre"), p.telefono() == null || p.telefono().isBlank() ? null : p.telefono().trim(),
                    Boolean.TRUE.equals(p.consentimiento()), p.categoria() == null || p.categoria().isBlank() ? null : p.categoria(), tsCorr, disp.id(),
                    ReglasKiosco.codigoProvisional(disp.numero(), ev.seq()), tardio, false);
            repositorio.marcarEvento(fila.id(), "APLICADO", null, t.id(), tsCorr, payloadSinDatos);
            return Resultado.conTurno(clave, "APLICADO", new TurnoKiosco(t.codigo(), t.token(), t.posicion()));
        } catch (ErrorNegocio e) {
            if ("TURNO_DUPLICADO".equals(e.codigo()) && e.extra().get("token") instanceof String token) {
                // RN-M5-05: el cliente ya tenía turno activo ⇒ se enlaza al existente
                var t = repositorio.turnoPorToken(token);
                repositorio.marcarEvento(fila.id(), "DUPLICADO", "TURNO_EXISTENTE", t.map(TurnoBreve::id).orElse(null), tsCorr, payloadSinDatos);
                if (t.isPresent()) {
                    return Resultado.conTurno(clave, "DUPLICADO", new TurnoKiosco(t.get().codigo(), t.get().token(), null));
                }
            }
            if (!A_REVISION.contains(e.codigo())) {
                LOG.warn("evento de kiosco no aplicado dispositivo={} codigo={} {}", disp.id(), e.codigo(), e.getMessage());
            }
            return revision(disp, fila, tsCorr, e.codigo());
        }
    }

    private Resultado revision(Dispositivo disp, Evento fila, Instant tsCorr, String motivo) {
        repositorio.marcarEvento(fila.id(), "REVISION", motivo, null, tsCorr, null);
        eventos.publishEvent(new EventoPantalla("kiosco:evento", disp.localId(), Map.of("dispositivoId", disp.id(), "estado", "REVISION")));
        return Resultado.sinTurno(fila.claveIdem(), "REVISION", motivo);
    }

    private Resultado existente(String clave) {
        Evento e = repositorio.evento(clave).orElse(null);
        if (e == null || "PENDIENTE".equals(e.estado())) {
            return null;
        }
        if (("APLICADO".equals(e.estado()) || "DUPLICADO".equals(e.estado())) && e.turnoId() != null) {
            var t = repositorio.turno(e.turnoId());
            if (t.isPresent()) {
                return Resultado.conTurno(clave, "DUPLICADO", new TurnoKiosco(t.get().codigo(), t.get().token(), null));
            }
        }
        return Resultado.sinTurno(clave, "REVISION".equals(e.estado()) ? "REVISION" : "RECHAZADO", e.motivo() == null ? "REVISION" : e.motivo());
    }

    public record Lote(List<Resultado> resultados, Integer ackSeq, String serverTime) {
    }

    public Lote sincronizar(Dispositivo disp, List<EventoEntrada> lote) {
        if (lote.size() > 100) {
            throw new ErrorNegocio("M5_LOTE_DEMASIADO_GRANDE", "Máximo 100 eventos por lote", 413);
        }
        var ordenados = new ArrayList<>(lote);
        ordenados.sort(Comparator.comparing(e -> e.seq() == null ? 0 : e.seq()));
        List<Resultado> resultados = new ArrayList<>();
        for (var ev : ordenados) {
            resultados.add(aplicar(disp, ev));
        }
        LOG.info("lote de kiosco dispositivo={} n={} aplicados={} revision={}", disp.id(), lote.size(),
                resultados.stream().filter(r -> r.estado().equals("APLICADO")).count(), resultados.stream().filter(r -> r.estado().equals("REVISION")).count());
        return new Lote(resultados, ordenados.isEmpty() ? null : ordenados.getLast().seq(), reloj.instant().toString());
    }

    public CheckinPresencial.Resultado checkinCita(Dispositivo d, String codigo) {
        String c = codigo == null ? "" : codigo.trim();
        if (c.contains("/")) {
            c = c.substring(c.lastIndexOf('/') + 1);
        }
        if (c.length() < 6 || c.length() > 16) {
            throw new ErrorNegocio("VALIDACION", "Código inválido", 422);
        }
        return citas.porCodigo(d.localId(), c);
    }

    // --- Cola de revisión (admin) ---

    public record Eventos(List<RepositorioKiosco.EventoListado> items, String cursor) {
    }

    public Eventos eventos(int localId, String estado, Integer dispositivoId, Long cursor) {
        modulos.exigir(localId, Modulo.M5);
        var items = repositorio.eventos(localId, estado == null || estado.isBlank() ? null : estado, dispositivoId, cursor, 50);
        return new Eventos(items, items.size() == 50 ? String.valueOf(items.getLast().id()) : null);
    }

    public record Resuelto(String estado, TurnoKiosco turno) {
    }

    public Resuelto resolver(int localId, long id, String accion, int usuarioId) {
        modulos.exigir(localId, Modulo.M5);
        Evento e = repositorio.eventoDelLocal(localId, id).filter(x -> "REVISION".equals(x.estado()))
                .orElseThrow(() -> ErrorNegocio.conflicto("M5_EVENTO_INVALIDO", "El evento no está en revisión"));
        JsonPayload p = leer(e.payloadJson());
        String sinDatos = json.writeValueAsString(Map.of("colaId", p.colaId() == null ? 0 : p.colaId()));
        Instant ahora = reloj.instant();
        if ("DESCARTAR".equals(accion)) {
            repositorio.resolverEvento(id, "RECHAZADO", null, usuarioId, ahora, sinDatos);
            return new Resuelto("RECHAZADO", null);
        }
        if (!"EMITIR_AHORA".equals(accion)) {
            throw new ErrorNegocio("VALIDACION", "Acción inválida", 422);
        }
        Dispositivo d = repositorio.dispositivo(e.dispositivoId()).orElseThrow();
        var t = tomaDeTurnos.porKiosco(p.colaId() == null ? 0 : p.colaId(), p.nombre(), null, false, p.categoria() == null || p.categoria().isBlank() ? null : p.categoria(),
                null, d.id(), ReglasKiosco.codigoProvisional(d.numero(), e.seq()), true, true);
        repositorio.resolverEvento(id, "APLICADO", t.id(), usuarioId, ahora, sinDatos);
        return new Resuelto("APLICADO", new TurnoKiosco(t.codigo(), t.token(), t.posicion()));
    }

    record JsonPayload(Integer colaId, String categoria, String nombre) {
    }

    private JsonPayload leer(String payload) {
        var n = json.readTree(payload == null ? "{}" : payload);
        return new JsonPayload(n.hasNonNull("colaId") ? n.get("colaId").asInt() : null, n.hasNonNull("categoria") ? n.get("categoria").asString() : null,
                n.hasNonNull("nombre") ? n.get("nombre").asString() : null);
    }

    // --- Ticket provisional (QR) ---

    public record Provisional(String estado, String token, String codigo) {
    }

    public Provisional resolverProvisional(int dispositivoId, LocalDate fecha, int seq) {
        var d = repositorio.dispositivo(dispositivoId).orElse(null);
        if (d == null) {
            return new Provisional("PENDIENTE", null, null);
        }
        var zona = locales.exigir(d.localId()).zonaHoraria();
        Evento e = repositorio.eventosPorSeq(dispositivoId, seq).stream()
                .filter(x -> Fechas.fechaLocal(zona, x.tsDispositivo()).equals(fecha)).findFirst().orElse(null);
        if (e == null) {
            return new Provisional("PENDIENTE", null, null);
        }
        if (e.turnoId() != null) {
            var t = repositorio.turno(e.turnoId());
            if (t.isPresent()) {
                return new Provisional("LISTO", t.get().token(), t.get().codigo());
            }
        }
        return new Provisional("REVISION".equals(e.estado()) ? "REVISION" : "PENDIENTE", null, null);
    }

    // --- Jobs ---

    /** Marca sin conexión los kioscos sin latido en 75 s (M7 levanta KIOSCO_OFFLINE). */
    public Map<String, Object> jobVigilancia() {
        var caidos = repositorio.sinLatidoDesde(reloj.instant().minusMillis(ReglasKiosco.SIN_LATIDO_MS));
        for (var d : caidos) {
            repositorio.marcarSinConexion(d.id());
            eventos.publishEvent(new EventoPantalla("kiosco:estado", d.localId(), Map.of("dispositivoId", d.id(), "enLinea", false)));
            eventos.publishEvent(new KioscoSinConexion(d.localId(), d.id(), "K" + d.numero() + " · " + d.nombre()));
        }
        return Map.of("sinConexion", caidos.size());
    }

    public Map<String, Object> jobLimpieza() {
        return Map.of("eliminados", repositorio.borrarEventosAntiguos(reloj.instant().minus(Duration.ofDays(30))));
    }

    private static String recortar(String s, int max) {
        return s == null ? null : s.length() > max ? s.substring(0, max) : s;
    }
}
