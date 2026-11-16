package pe.turnoya.kiosco.dispositivos;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.kiosco.dominio.ReglasKiosco;
import pe.turnoya.kiosco.dominio.RepositorioKiosco;
import pe.turnoya.kiosco.dominio.RepositorioKiosco.Dispositivo;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;

/** §6.6 Administración de kioscos: crear (con código de emparejamiento y PIN de mantenimiento), editar, revocar y rotar. */
@Service
public class GestionKioscos {

    private static final SecureRandom AZAR = new SecureRandom();

    private final RepositorioKiosco repositorio;
    private final ModulosLocal modulos;
    private final Auditoria auditoria;
    private final Clock reloj;

    GestionKioscos(RepositorioKiosco repositorio, ModulosLocal modulos, Auditoria auditoria, Clock reloj) {
        this.repositorio = repositorio;
        this.modulos = modulos;
        this.auditoria = auditoria;
        this.reloj = reloj;
    }

    public record VistaDispositivo(int id, int numero, String prefijo, String nombre, List<Integer> colaIds, boolean activo, boolean emparejado,
                                   String versionApp, Instant ultimoHeartbeatAt, boolean enLinea, boolean relojDesfasado, int offsetRelojMs,
                                   int pendientes, String impresora, Instant codigoVigenteHasta) {

        public String estado() {
            return !activo ? "Revocado" : !emparejado ? "Sin emparejar" : enLinea ? "En línea" : "Sin conexión";
        }
    }

    public record Codigo(String codigo, Instant expira) {
    }

    public record Creado(VistaDispositivo dispositivo, String pinMantenimiento, String codigo, Instant expira) {
    }

    public List<VistaDispositivo> listar(int localId) {
        return repositorio.dispositivos(localId).stream().map(this::vista).toList();
    }

    @Transactional
    public Creado crear(int localId, String nombre, List<Integer> colaIds, Auditoria.Actor actor) {
        modulos.exigir(localId, Modulo.M5);
        String n = nombre == null ? "" : nombre.trim();
        if (n.length() < 2 || n.length() > 40) {
            throw new ErrorNegocio("VALIDACION", "El nombre debe tener de 2 a 40 caracteres", 422);
        }
        List<Integer> colas = colaIds == null ? List.of() : colaIds;
        if (repositorio.contarActivos(localId) >= ReglasKiosco.MAX_DISPOSITIVOS) {
            throw new ErrorNegocio("M5_LIMITE_DISPOSITIVOS", "El plan permite hasta " + ReglasKiosco.MAX_DISPOSITIVOS + " kioscos", 402);
        }
        validarColas(localId, colas);
        String pin = String.valueOf(AZAR.nextInt(9000) + 1000);
        auditoria.fijarActor(actor);
        int id = repositorio.crear(localId, repositorio.siguienteNumero(localId), n, colas, sha(pin));
        Codigo c = nuevoCodigo(id);
        VistaDispositivo v = vista(repositorio.dispositivo(id).orElseThrow());
        auditoria.registrar(actor, localId, "KIOSCO_CREAR", "dispositivo_kiosco", id, "Registró el kiosco " + v.prefijo() + " (" + n + ")", Map.of("nombre", n));
        // El PIN de mantenimiento se muestra una sola vez al admin; en la BD queda solo su hash
        return new Creado(v, pin, c.codigo(), c.expira());
    }

    @Transactional
    public VistaDispositivo editar(int localId, int id, String nombre, List<Integer> colaIds, Boolean activo, String pin, Auditoria.Actor actor) {
        Dispositivo d = exigir(localId, id);
        if (nombre != null && (nombre.trim().length() < 2 || nombre.trim().length() > 40)) {
            throw new ErrorNegocio("VALIDACION", "El nombre debe tener de 2 a 40 caracteres", 422);
        }
        if (pin != null && !pin.matches("\\d{4,8}")) {
            throw new ErrorNegocio("VALIDACION", "El PIN tiene de 4 a 8 dígitos", 422);
        }
        if (colaIds != null) {
            validarColas(localId, colaIds);
        }
        auditoria.fijarActor(actor);
        repositorio.editar(d.id(), nombre == null ? null : nombre.trim(), colaIds, activo, pin == null ? null : sha(pin));
        VistaDispositivo v = vista(repositorio.dispositivo(id).orElseThrow());
        if (Boolean.FALSE.equals(activo)) {
            auditoria.registrar(actor, localId, "KIOSCO_REVOCAR", "dispositivo_kiosco", id, "Revocó el kiosco " + v.prefijo(), null);
        }
        return v;
    }

    /** Rota el token: el kiosco debe volver a emparejarse con el código nuevo. */
    @Transactional
    public Codigo rotar(int localId, int id, Auditoria.Actor actor) {
        exigir(localId, id);
        auditoria.fijarActor(actor);
        repositorio.revocarToken(id);
        Codigo c = nuevoCodigo(id);
        auditoria.registrar(actor, localId, "KIOSCO_ROTAR", "dispositivo_kiosco", id, "Rotó el token de un kiosco", null);
        return c;
    }

    /** Código de emparejamiento de 6 dígitos, un solo uso, 10 min; se guarda solo su hash. */
    private Codigo nuevoCodigo(int id) {
        String codigo = String.format("%06d", AZAR.nextInt(1_000_000));
        Instant expira = reloj.instant().plus(Duration.ofMinutes(10));
        repositorio.guardarCodigo(id, sha(codigo), expira);
        return new Codigo(codigo, expira);
    }

    private Dispositivo exigir(int localId, int id) {
        modulos.exigir(localId, Modulo.M5);
        return repositorio.dispositivoDelLocal(localId, id).orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "El kiosco no existe"));
    }

    private void validarColas(int localId, List<Integer> colaIds) {
        if (colaIds.size() > 20) {
            throw new ErrorNegocio("VALIDACION", "Máximo 20 colas por kiosco", 422);
        }
        if (!colaIds.isEmpty() && repositorio.colasDelLocal(localId, colaIds) != colaIds.size()) {
            throw new ErrorNegocio("VALIDACION", "Alguna cola no pertenece al local", 422);
        }
    }

    VistaDispositivo vista(Dispositivo d) {
        Instant ahora = reloj.instant();
        boolean enLinea = d.activo() && d.tokenHash() != null && d.ultimoHeartbeatAt() != null
                && Duration.between(d.ultimoHeartbeatAt(), ahora).toMillis() <= ReglasKiosco.SIN_LATIDO_MS;
        return new VistaDispositivo(d.id(), d.numero(), "K" + d.numero(), d.nombre(), d.colaIds(), d.activo(), d.tokenHash() != null, d.versionApp(),
                d.ultimoHeartbeatAt(), enLinea, Math.abs(d.offsetRelojMs()) > ReglasKiosco.DESFASE_ALERTA_MS, d.offsetRelojMs(), d.pendientes(),
                d.impresora(), d.codigoExpira() != null && d.codigoExpira().isAfter(ahora) ? d.codigoExpira() : null);
    }

    public static String sha(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
