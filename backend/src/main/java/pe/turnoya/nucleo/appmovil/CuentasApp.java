package pe.turnoya.nucleo.appmovil;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.seguridad.Telefonos;
import pe.turnoya.compartido.seguridad.Tokens;
import pe.turnoya.nucleo.dominio.RepositorioApp;
import pe.turnoya.nucleo.dominio.RepositorioApp.CodigoPendiente;
import pe.turnoya.nucleo.dominio.RepositorioApp.CuentaCorreo;
import pe.turnoya.nucleo.dominio.RepositorioApp.TurnoDeCliente;
import pe.turnoya.nucleo.emision.EmisionTurnos;
import pe.turnoya.nucleo.puertos.CodigosPorWhatsApp;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;

/**
 * Cuenta del cliente en la app móvil. Se abre de dos formas: con correo y contraseña (registro en la app) o
 * verificando el celular con un código de un solo uso enviado por WhatsApp. Las dos terminan en una sesión. Con la sesión, los turnos de la app quedan a nombre del cliente (un turno activo por cola, avisos por
 * WhatsApp e historial). Ni el código ni el token de sesión se guardan: solo sus hashes.
 */
@Service
public class CuentasApp {

    private static final Duration VIGENCIA_CODIGO = Duration.ofMinutes(10);
    private static final Duration ESPERA_REENVIO = Duration.ofSeconds(60);
    private static final int MAX_INTENTOS = 5;
    private static final SecureRandom ALEATORIO = new SecureRandom();
    private static final int MAX_FALLOS_CLAVE = 5;
    private static final Duration BLOQUEO_CLAVE = Duration.ofMinutes(15);
    private static final Pattern CORREO = Pattern.compile("^[^@\\s]{1,64}@[^@\\s]+\\.[^@\\s]{2,}$");

    private final RepositorioApp repositorio;
    private final CatalogoLocales locales;
    private final EmisionTurnos emision;
    private final ObjectProvider<CodigosPorWhatsApp> codigos;
    private final PasswordEncoder claves;
    private final Clock reloj;
    /** Hash de relleno: si el correo no existe se compara igual, para no delatar con el tiempo qué correos tienen cuenta. */
    private final String hashDeRelleno;

    CuentasApp(RepositorioApp repositorio, CatalogoLocales locales, EmisionTurnos emision, ObjectProvider<CodigosPorWhatsApp> codigos,
               PasswordEncoder claves, Clock reloj) {
        this.claves = claves;
        this.hashDeRelleno = claves.encode("relleno-" + Tokens.generar(16));
        this.repositorio = repositorio;
        this.locales = locales;
        this.emision = emision;
        this.codigos = codigos;
        this.reloj = reloj;
    }

    public record SesionAbierta(String token, String telefono, String nombre, String correo) {
    }

    /** Crea la cuenta con correo y contraseña y abre la sesión. */
    @Transactional
    public SesionAbierta registrar(String correo, String clave, String nombre, boolean consentimiento, String dispositivo) {
        if (!consentimiento) {
            throw new ErrorNegocio("CONSENTIMIENTO_REQUERIDO", "Debes aceptar la política de datos para crear tu cuenta");
        }
        String limpio = validarCorreo(correo);
        String nombreLimpio = nombre == null ? "" : nombre.trim().replaceAll("\\s+", " ");
        if (nombreLimpio.length() < 2 || nombreLimpio.length() > 60) {
            throw new ErrorNegocio("NOMBRE_INVALIDO", "Escribe tu nombre (entre 2 y 60 letras).", 422);
        }
        if (clave == null || clave.length() < 8 || clave.length() > 72 || !clave.matches(".*\\p{L}.*") || !clave.matches(".*\\d.*")) {
            throw new ErrorNegocio("CLAVE_DEBIL", "La contraseña debe tener al menos 8 caracteres, con letras y números.", 422);
        }
        if (repositorio.cuentaPorCorreo(limpio).isPresent()) {
            throw new ErrorNegocio("CUENTA_EXISTENTE", "Ya hay una cuenta con ese correo. Ingresa con tu contraseña.", 409);
        }
        Instant ahora = reloj.instant();
        int clienteId = repositorio.crearCliente(nombreLimpio, ahora);
        repositorio.crearCuenta(clienteId, limpio, claves.encode(clave), ahora);
        repositorio.anotarIngreso(clienteId, ahora);
        return abrirSesion(clienteId, null, nombreLimpio, limpio, dispositivo, ahora);
    }

    /**
     * Ingresa con correo y contraseña. Tras {@value #MAX_FALLOS_CLAVE} intentos fallidos la cuenta se bloquea 15 min.
     * No es transaccional: el intento fallido debe quedar anotado aunque la petición termine en error.
     */
    public SesionAbierta ingresar(String correo, String clave, String dispositivo) {
        Instant ahora = reloj.instant();
        String limpio = correo == null ? "" : correo.trim();
        Optional<CuentaCorreo> cuenta = repositorio.cuentaPorCorreo(limpio);
        if (cuenta.isPresent() && cuenta.get().bloqueadaHasta() != null && cuenta.get().bloqueadaHasta().isAfter(ahora)) {
            throw new ErrorNegocio("APP_CUENTA_BLOQUEADA", "Demasiados intentos fallidos. Vuelve a intentarlo en unos minutos.", 429,
                    java.util.Map.of("hasta", cuenta.get().bloqueadaHasta().toString()));
        }
        boolean correcta = claves.matches(clave == null ? "" : clave, cuenta.map(CuentaCorreo::claveHash).orElse(hashDeRelleno));
        if (cuenta.isEmpty() || !correcta) {
            cuenta.ifPresent(c -> {
                int fallos = c.intentosFallidos() + 1;
                repositorio.anotarFallo(c.clienteId(), fallos >= MAX_FALLOS_CLAVE ? 0 : fallos, fallos >= MAX_FALLOS_CLAVE ? ahora.plus(BLOQUEO_CLAVE) : null);
            });
            throw new ErrorNegocio("CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos.", 401);
        }
        CuentaCorreo c = cuenta.get();
        repositorio.anotarIngreso(c.clienteId(), ahora);
        String nombre = repositorio.datosCliente(c.clienteId()).map(RepositorioApp.DatosCliente::nombre).orElse(null);
        return abrirSesion(c.clienteId(), null, nombre, c.correo(), dispositivo, ahora);
    }

    private SesionAbierta abrirSesion(int clienteId, String telefono, String nombre, String correo, String dispositivo, Instant ahora) {
        String token = Tokens.generar(40);
        repositorio.crearSesion(sha256(token), clienteId, dispositivo == null ? null : hashDispositivo(dispositivo), ahora);
        return new SesionAbierta(token, telefono, nombre == null || nombre.isBlank() ? null : nombre.trim(), correo);
    }

    private static String validarCorreo(String correo) {
        String limpio = correo == null ? "" : correo.trim();
        if (limpio.length() > 120 || !CORREO.matcher(limpio).matches()) {
            throw new ErrorNegocio("CORREO_INVALIDO", "Escribe un correo válido (ej. nombre@gmail.com).", 422);
        }
        return limpio;
    }

    /** Envía el código por el WhatsApp del local donde está el cliente (el que escaneó). */
    @Transactional
    public void pedirCodigo(String slug, String telefono) {
        Local local = locales.activoPorSlug(slug == null ? "" : slug.trim().toLowerCase());
        String e164 = normalizar(telefono);
        String hash = Telefonos.hash(e164);
        Instant ahora = reloj.instant();
        Optional<CodigoPendiente> previo = repositorio.codigo(hash);
        if (previo.isPresent() && previo.get().creado().plus(ESPERA_REENVIO).isAfter(ahora)) {
            throw new ErrorNegocio("APP_CODIGO_RECIENTE", "Ya te enviamos un código. Espera un minuto para pedir otro.", 429);
        }
        String codigo = String.format("%06d", ALEATORIO.nextInt(1_000_000));
        repositorio.guardarCodigo(hash, sha256(hash + ":" + codigo), ahora.plus(VIGENCIA_CODIGO), ahora);
        CodigosPorWhatsApp envio = codigos.getIfAvailable();
        if (envio == null || !envio.enviar(local.id(), e164, codigo)) {
            repositorio.borrarCodigo(hash);
            throw new ErrorNegocio("APP_SIN_WHATSAPP", "Este local no puede enviar el código por WhatsApp. Puedes tomar tu turno sin cuenta.", 409);
        }
    }

    /** El intento fallido debe quedar contado aunque la petición termine en error: por eso no es transaccional. */
    public SesionAbierta verificar(String telefono, String codigo, String nombre, boolean consentimiento, String dispositivo) {
        if (!consentimiento) {
            throw new ErrorNegocio("CONSENTIMIENTO_REQUERIDO", "Debes aceptar la política de datos para crear tu cuenta");
        }
        String e164 = normalizar(telefono);
        String hash = Telefonos.hash(e164);
        Instant ahora = reloj.instant();
        CodigoPendiente pendiente = repositorio.codigo(hash).filter(c -> c.expira().isAfter(ahora))
                .orElseThrow(() -> new ErrorNegocio("APP_CODIGO_VENCIDO", "El código venció. Pide uno nuevo.", 410));
        if (pendiente.intentos() >= MAX_INTENTOS) {
            repositorio.borrarCodigo(hash);
            throw new ErrorNegocio("APP_CODIGO_BLOQUEADO", "Demasiados intentos. Pide un código nuevo.", 429);
        }
        String limpio = codigo == null ? "" : codigo.replaceAll("\\D", "");
        if (!MessageDigest.isEqual(pendiente.codigoHash().getBytes(StandardCharsets.UTF_8),
                sha256(hash + ":" + limpio).getBytes(StandardCharsets.UTF_8))) {
            repositorio.sumarIntento(hash);
            throw new ErrorNegocio("APP_CODIGO_INCORRECTO", "El código no es correcto.", 422);
        }
        repositorio.borrarCodigo(hash);
        Integer clienteId = emision.resolverCliente(nombre, e164, true);
        return abrirSesion(clienteId, Telefonos.enmascarar(e164), nombre, null, dispositivo, ahora);
    }

    /** Cliente de la cabecera {@code Authorization: Bearer …}. Vacío si no viene; error si viene y no es válida. */
    public Optional<Integer> clienteDe(String autorizacion) {
        String token = bearer(autorizacion);
        if (token == null) {
            return Optional.empty();
        }
        return Optional.of(repositorio.clienteDeSesion(sha256(token), reloj.instant())
                .orElseThrow(() -> new ErrorNegocio("APP_SESION_INVALIDA", "Tu sesión terminó. Vuelve a ingresar.", 401)));
    }

    public int exigirCliente(String autorizacion) {
        return clienteDe(autorizacion).orElseThrow(() -> new ErrorNegocio("APP_SESION_INVALIDA", "Ingresa a tu cuenta para continuar.", 401));
    }

    public void cerrar(String autorizacion) {
        String token = bearer(autorizacion);
        if (token != null) {
            repositorio.revocarSesion(sha256(token), reloj.instant());
        }
    }

    public List<TurnoDeCliente> historial(String autorizacion) {
        return repositorio.turnosDeCliente(exigirCliente(autorizacion), 30);
    }

    /** Códigos vencidos que nadie usó. */
    public String limpiar() {
        return repositorio.borrarCodigosVencidos(reloj.instant().minus(Duration.ofHours(1))) + " códigos vencidos borrados";
    }

    /** El identificador lo genera la app al instalarse; aquí solo se guarda su hash. */
    static String hashDispositivo(String dispositivo) {
        String d = dispositivo == null ? "" : dispositivo.trim();
        if (!d.matches("[A-Za-z0-9_-]{16,64}")) {
            throw new ErrorNegocio("APP_DISPOSITIVO_INVALIDO", "Actualiza la app para tomar tu turno.", 422);
        }
        return sha256("dispositivo:" + d);
    }

    private static String normalizar(String telefono) {
        return Telefonos.normalizar(telefono)
                .orElseThrow(() -> new ErrorNegocio("TELEFONO_INVALIDO", "El celular no es válido (9 dígitos, ej. 951234567)"));
    }

    private static String bearer(String autorizacion) {
        if (autorizacion == null || !autorizacion.regionMatches(true, 0, "Bearer ", 0, 7)) {
            return null;
        }
        String token = autorizacion.substring(7).trim();
        return token.isEmpty() || token.length() > 100 ? null : token;
    }

    static String sha256(String texto) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(texto.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
