package pe.turnoya.plataforma.pagos;

import java.util.Locale;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.dominio.PasarelaPagos;
import pe.turnoya.plataforma.dominio.PasarelaPagos.Cobro;
import pe.turnoya.plataforma.dominio.PasarelaPagos.Tarjeta;
import pe.turnoya.plataforma.dominio.RepositorioPagos;
import pe.turnoya.plataforma.dominio.RepositorioPagos.PlanVenta;
import pe.turnoya.plataforma.locales.GestionLocales;
import pe.turnoya.plataforma.pagos.SuscripcionPlanes.RegistroGuardado;
import pe.turnoya.plataforma.pagos.SuscripcionPlanes.Resultado;
import tools.jackson.databind.ObjectMapper;

/**
 * Alta pública de un local ({@code /registro}). Plan gratuito: se crea de inmediato. Plan de pago: se cobra el primer
 * mes con la tarjeta tokenizada; si el pago queda en revisión, el local se crea cuando el webhook confirma la aprobación
 * ({@link SuscripcionPlanes#aplicarPago}). Mismas reglas que el sistema anterior.
 */
@Service
public class RegistroPublico {

    private final RepositorioPagos pagos;
    private final PasarelaPagos pasarela;
    private final SuscripcionPlanes suscripcion;
    private final GestionLocales altas;
    private final ModulosLocal modulos;
    private final PasswordEncoder claves;
    private final TransactionTemplate transaccion;
    private final PropiedadesTurnoYa propiedades;
    private final ObjectMapper json;

    RegistroPublico(RepositorioPagos pagos, PasarelaPagos pasarela, SuscripcionPlanes suscripcion, GestionLocales altas, ModulosLocal modulos,
                    PasswordEncoder claves, TransactionTemplate transaccion, PropiedadesTurnoYa propiedades, ObjectMapper json) {
        this.pagos = pagos;
        this.pasarela = pasarela;
        this.suscripcion = suscripcion;
        this.altas = altas;
        this.modulos = modulos;
        this.claves = claves;
        this.transaccion = transaccion;
        this.propiedades = propiedades;
        this.json = json;
    }

    public Resultado registrar(Solicitud s) {
        Solicitud d = s.validada();
        PlanVenta plan = pagos.planPorCodigo(d.plan()).orElseThrow(() -> ErrorNegocio.noEncontrado("PLAN_INVALIDO", "El plan no existe"));
        var previo = pagos.porClaveIdem(d.claveIdem());
        if (previo.isPresent()) {
            return suscripcion.resultado(previo.get().id());
        }
        altas.exigirDisponible(d.slug(), d.adminEmail());
        RegistroGuardado registro = new RegistroGuardado(plan.codigo(), d.nombreComercial(), d.razonSocial(), d.ruc(), d.rubro(), d.ciudad(),
                d.direccion(), d.telefono(), d.slug(), d.adminNombre(), d.adminEmail(), claves.encode(d.password()));

        if (plan.precio().signum() == 0) {
            Local local = transaccion.execute(t -> altas.altaRegistrada(registro.alta(plan.id(), null), registro.adminNombre(),
                    registro.adminEmail(), registro.hashPassword()));
            modulos.invalidar(local.id());
            return new Resultado("APROBADO", null, local.slug(), "Tu local está listo. Inicia sesión con tu correo.", null);
        }
        Tarjeta tarjeta = d.tarjeta();
        if (tarjeta == null || tarjeta.token() == null) {
            throw new ErrorNegocio("PAGO_REQUERIDO", "Ingresa los datos de la tarjeta para pagar el primer mes", 422);
        }
        int pagoId = pagos.crear(null, plan.id(), d.claveIdem(), plan.precio(), 1, tarjeta.payer() == null ? null : tarjeta.payer().email(),
                json.writeValueAsString(registro));
        try {
            Cobro cobro = pasarela.cobrar(tarjeta, plan.precio(), "TurnoYa · Plan " + plan.nombre() + " · 1 mes", "pago-" + pagoId, d.claveIdem(),
                    urlNotificacion());
            suscripcion.registrarResultado(pagoId, cobro);
        } catch (RuntimeException e) {
            String detalle = e.getMessage() == null ? "error" : e.getMessage().substring(0, Math.min(200, e.getMessage().length()));
            pagos.registrarResultado(pagoId, null, "RECHAZADO", detalle, null, null, true);
            throw e;
        }
        return suscripcion.resultado(pagoId);
    }

    /** Estado de un pago en revisión; la clave de idempotencia evita consultar pagos ajenos. */
    public Resultado estado(int pagoId, String claveIdem) {
        return pagos.porId(pagoId)
                .filter(p -> claveIdem != null && pagos.porClaveIdem(claveIdem).map(x -> x.id() == p.id()).orElse(false))
                .map(p -> suscripcion.resultado(p.id()))
                .orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "El pago no existe"));
    }

    public boolean pagosHabilitados() {
        return pasarela.configurada();
    }

    public String clavePublica() {
        return pasarela.clavePublica();
    }

    private String urlNotificacion() {
        String url = propiedades.urlPublica();
        return url.startsWith("https://") ? url + "/api/v1/webhooks/mercadopago" : null;
    }

    /** Cuerpo de {@code POST /api/v1/public/registro}. */
    public record Solicitud(String plan, String nombreComercial, String razonSocial, String ruc, String rubro, String ciudad, String direccion,
                            String telefono, String slug, String adminNombre, String adminEmail, String password, Boolean aceptaTerminos,
                            String claveIdem, Tarjeta tarjeta) {

        Solicitud validada() {
            String p = plan == null ? "" : plan.trim().toUpperCase(Locale.ROOT);
            String nc = texto(nombreComercial, 2, 80, "Nombre comercial");
            String rs = texto(razonSocial, 2, 120, "Razón social");
            String r = ruc == null || ruc.isBlank() ? null : ruc.trim();
            if (r != null && !r.matches("\\d{11}")) {
                throw invalido("El RUC tiene 11 dígitos");
            }
            String rubroV = rubro == null || rubro.isBlank() ? "Salud" : texto(rubro, 2, 40, "Rubro");
            String ciudadV = ciudad == null || ciudad.isBlank() ? "Juliaca" : texto(ciudad, 2, 60, "Ciudad");
            String dir = opcional(direccion, 160, "Dirección");
            String tel = opcional(telefono, 20, "Teléfono");
            String s = slug == null ? "" : slug.trim().toLowerCase(Locale.ROOT);
            if (!s.matches("^[a-z0-9-]{3,40}$")) {
                throw invalido("Usa minúsculas, números y guiones (3–40)");
            }
            String an = texto(adminNombre, 2, 80, "Tu nombre");
            String ae = adminEmail == null ? "" : adminEmail.trim().toLowerCase(Locale.ROOT);
            if (!ae.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
                throw invalido("Correo inválido");
            }
            if (password == null || password.length() < 8 || password.length() > 72) {
                throw invalido("Contraseña: de 8 a 72 caracteres");
            }
            if (!Boolean.TRUE.equals(aceptaTerminos)) {
                throw invalido("Debes aceptar los términos");
            }
            if (claveIdem == null || !claveIdem.matches("^[0-9a-fA-F-]{36}$")) {
                throw invalido("Solicitud inválida, recarga la página");
            }
            return new Solicitud(p, nc, rs, r, rubroV, ciudadV, dir, tel, s, an, ae, password, true, claveIdem, tarjeta);
        }

        private static String texto(String v, int min, int max, String campo) {
            String t = v == null ? "" : v.trim();
            if (t.length() < min || t.length() > max) {
                throw invalido(campo + ": entre " + min + " y " + max + " caracteres");
            }
            return t;
        }

        private static String opcional(String v, int max, String campo) {
            if (v == null || v.isBlank()) {
                return null;
            }
            if (v.trim().length() > max) {
                throw invalido(campo + ": hasta " + max + " caracteres");
            }
            return v.trim();
        }

        private static ErrorNegocio invalido(String mensaje) {
            return new ErrorNegocio("VALIDACION", mensaje, 422);
        }
    }

    /** Planes a la venta para la página de registro (precio 0 = gratis). */
    public java.util.List<PlanVenta> planes() {
        return pagos.planes();
    }
}
