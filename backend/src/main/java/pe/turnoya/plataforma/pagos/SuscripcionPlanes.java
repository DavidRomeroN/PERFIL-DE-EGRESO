package pe.turnoya.plataforma.pagos;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Plan;
import pe.turnoya.plataforma.dominio.PasarelaPagos;
import pe.turnoya.plataforma.dominio.PasarelaPagos.Cobro;
import pe.turnoya.plataforma.dominio.PasarelaPagos.Tarjeta;
import pe.turnoya.plataforma.dominio.RepositorioPagos;
import pe.turnoya.plataforma.dominio.RepositorioPagos.Pago;
import pe.turnoya.plataforma.dominio.RepositorioPagos.PlanVenta;
import pe.turnoya.plataforma.dominio.RepositorioLocales.AltaLocal;
import pe.turnoya.plataforma.locales.GestionLocales;
import tools.jackson.databind.ObjectMapper;

/**
 * Cambio y renovación del plan de un local pagando con tarjeta. Un pago APROBADO se aplica una sola vez
 * (columna {@code aplicado_at}), venga de la respuesta directa de Mercado Pago o del webhook.
 */
@Service
public class SuscripcionPlanes {

    private static final Logger log = LoggerFactory.getLogger(SuscripcionPlanes.class);

    private final RepositorioPagos pagos;
    private final PasarelaPagos pasarela;
    private final CatalogoLocales locales;
    private final ModulosLocal modulos;
    private final Auditoria auditoria;
    private final TransactionTemplate transaccion;
    private final PropiedadesTurnoYa propiedades;
    private final Clock reloj;
    private final GestionLocales altas;
    private final ObjectMapper json;

    SuscripcionPlanes(RepositorioPagos pagos, PasarelaPagos pasarela, CatalogoLocales locales, ModulosLocal modulos, Auditoria auditoria,
                      TransactionTemplate transaccion, PropiedadesTurnoYa propiedades, Clock reloj, GestionLocales altas,
                      ObjectMapper json) {
        this.pagos = pagos;
        this.pasarela = pasarela;
        this.locales = locales;
        this.modulos = modulos;
        this.auditoria = auditoria;
        this.transaccion = transaccion;
        this.propiedades = propiedades;
        this.reloj = reloj;
        this.altas = altas;
        this.json = json;
    }

    /** Plan actual, vencimiento, planes a la venta e historial (lo que muestra "Mi plan"). */
    public MiPlan miPlan(int localId) {
        Local local = locales.exigir(localId);
        Plan plan = locales.planDe(local);
        boolean vencido = local.planVenceAt() != null && local.planVenceAt().isBefore(reloj.instant());
        return new MiPlan(plan, local.planVenceAt(), vencido, pasarela.configurada(), pasarela.clavePublica(), pagos.planes(), pagos.historial(localId, 24));
    }

    public Resultado pagarPlan(int localId, String codigoPlan, int meses, Tarjeta tarjeta, String claveIdem, Auditoria.Actor actor) {
        PlanVenta plan = pagos.planPorCodigo(codigoPlan == null ? "" : codigoPlan)
                .filter(p -> p.precio().signum() > 0)
                .orElseThrow(() -> new ErrorNegocio("PLAN_INVALIDO", "Elige un plan de pago", 422));
        if (claveIdem == null || claveIdem.isBlank() || tarjeta == null || tarjeta.token() == null) {
            throw new ErrorNegocio("VALIDACION", "Faltan los datos de la tarjeta", 422);
        }
        var previo = pagos.porClaveIdem(claveIdem);
        if (previo.isPresent()) {
            return resultado(previo.get().id());
        }
        int m = Math.max(1, Math.min(12, meses));
        BigDecimal monto = plan.precio().multiply(BigDecimal.valueOf(m));
        int pagoId = pagos.crear(localId, plan.id(), claveIdem, monto, m, tarjeta.payer() == null ? null : tarjeta.payer().email(), null);
        try {
            Cobro cobro = pasarela.cobrar(tarjeta, monto, "TurnoYa · Plan " + plan.nombre() + " · " + m + (m > 1 ? " meses" : " mes"),
                    "pago-" + pagoId, claveIdem, urlNotificacion());
            registrarResultado(pagoId, cobro);
        } catch (RuntimeException e) {
            pagos.registrarResultado(pagoId, null, "RECHAZADO", recortar(e.getMessage()), null, null, true);
            throw e;
        }
        Resultado r = resultado(pagoId);
        auditoria.registrar(actor, localId, "PAGO_PLAN", "pago", pagoId, "Pagó el plan " + plan.codigo() + " por " + m + " mes(es): " + r.estado(),
                Map.of("plan", plan.codigo(), "meses", m, "estado", r.estado()));
        log.info("pago de plan local_id={} usuario_id={} plan={} meses={} estado={}", localId, actor.usuarioId(), plan.codigo(), m, r.estado());
        return r;
    }

    /** Webhook: se vuelve a consultar el cobro a Mercado Pago (no se confía en el cuerpo de la notificación). */
    public String procesarNotificacion(String idCobro) {
        Cobro cobro = pasarela.consultar(idCobro);
        Pago pago = null;
        if (cobro.referencia() != null && cobro.referencia().matches("^pago-\\d+$")) {
            pago = pagos.porId(Integer.parseInt(cobro.referencia().substring(5))).orElse(null);
        }
        if (pago == null) {
            pago = pagos.porIdProveedor(cobro.id()).orElse(null);
        }
        if (pago == null) {
            return "IGNORADO";
        }
        return registrarResultado(pago.id(), cobro);
    }

    public Resultado resultado(int pagoId) {
        Pago p = pagos.porId(pagoId).orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "Pago no encontrado"));
        String slug = p.localId() == null ? null : locales.porId(p.localId()).map(Local::slug).orElse(null);
        String mensaje = switch (p.estado()) {
            case "APROBADO" -> slug != null ? "¡Pago aprobado! Tu plan ya está activo." : "Pago aprobado.";
            case "EN_PROCESO", "PENDIENTE" -> "Tu pago está en revisión. Te avisaremos apenas se apruebe (normalmente en minutos).";
            default -> PasarelaPagos.mensajeRechazo(p.detalle());
        };
        return new Resultado(p.estado(), p.id(), slug, mensaje, p.ultimos4());
    }

    String registrarResultado(int pagoId, Cobro cobro) {
        boolean descartado = cobro.estado().equals("RECHAZADO") || cobro.estado().equals("CANCELADO");
        // Un registro rechazado no se aplicará nunca: se borran sus datos (incluida la contraseña hasheada)
        pagos.registrarResultado(pagoId, cobro.id(), cobro.estado(), cobro.detalle(), cobro.metodo(), cobro.ultimos4(), descartado);
        if (cobro.estado().equals("APROBADO")) {
            aplicarPago(pagoId);
        }
        return cobro.estado();
    }

    /** Aplica un pago aprobado una sola vez: extiende (misma vigencia) o cambia el plan y enciende sus módulos. */
    void aplicarPago(int pagoId) {
        Integer localId = transaccion.execute(estado -> pagos.bloquearParaAplicar(pagoId).map(pago -> {
            Instant ahora = reloj.instant();
            if (pago.localId() == null) {
                if (pago.registroJson() == null) {
                    log.warn("Pago {} aprobado sin local ni datos de registro: no hay nada que aplicar", pagoId);
                    return null;
                }
                // Alta de un local desde el registro público: se crea al aprobarse el primer pago
                RegistroGuardado r = json.readValue(pago.registroJson(), RegistroGuardado.class);
                Instant vence = ahora.atZone(ZoneOffset.UTC).plusMonths(pago.meses()).toInstant();
                Local nuevo = altas.altaRegistrada(r.alta(pago.planId(), vence), r.adminNombre(), r.adminEmail(), r.hashPassword());
                pagos.marcarAplicado(pagoId, nuevo.id());
                auditoria.registrar(Auditoria.Actor.SISTEMA, nuevo.id(), "PAGO_APLICADO", "pago", pagoId,
                        "Pago de S/ " + pago.monto() + " aplicado (alta del local, plan " + pago.plan() + ")", null);
                return nuevo.id();
            }
            Local local = locales.exigir(pago.localId());
            Instant base = local.planId() == pago.planId() && local.planVenceAt() != null && local.planVenceAt().isAfter(ahora) ? local.planVenceAt() : ahora;
            Instant vence = base.atZone(ZoneOffset.UTC).plusMonths(pago.meses()).toInstant();
            pagos.extenderPlan(local.id(), pago.planId(), vence);
            pagos.marcarAplicado(pagoId, local.id());
            auditoria.registrar(Auditoria.Actor.SISTEMA, local.id(), "PAGO_APLICADO", "pago", pagoId,
                    "Pago de S/ " + pago.monto() + " aplicado (plan " + pago.plan() + ", " + pago.meses() + " mes)", null);
            return local.id();
        }).orElse(null));
        if (localId != null) {
            modulos.invalidar(localId);
        }
    }

    /** Mercado Pago solo acepta notification_url públicas (https); en localhost se omite y se confía en la respuesta directa. */
    private String urlNotificacion() {
        String url = propiedades.urlPublica();
        return url.startsWith("https://") ? url + "/api/v1/webhooks/mercadopago" : null;
    }

    private static String recortar(String texto) {
        return texto == null ? "error" : texto.length() > 200 ? texto.substring(0, 200) : texto;
    }

    public record Resultado(String estado, Integer pagoId, String slug, String mensaje, String ultimos4) {
    }

    /** Datos del alta guardados en {@code pago.registro} mientras el primer pago está en proceso (contraseña ya hasheada). */
    record RegistroGuardado(String plan, String nombreComercial, String razonSocial, String ruc, String rubro, String ciudad, String direccion,
                            String telefono, String slug, String adminNombre, String adminEmail, String hashPassword) {

        AltaLocal alta(int planId, Instant venceAt) {
            return new AltaLocal(slug, nombreComercial, razonSocial, ruc, rubro, direccion, telefono, ciudad, planId, "#0f766e", venceAt);
        }
    }

    public record MiPlan(Plan plan, Instant venceAt, boolean vencido, boolean pagosHabilitados, String clavePublica, List<PlanVenta> planes,
                         List<Pago> pagos) {

        public long aprobados() {
            return pagos.stream().filter(p -> p.estado().equals("APROBADO")).count();
        }
    }
}
