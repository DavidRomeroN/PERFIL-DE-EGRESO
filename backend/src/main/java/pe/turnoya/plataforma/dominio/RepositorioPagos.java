package pe.turnoya.plataforma.dominio;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** Puerto de salida: pagos de suscripción (tabla {@code pago}) y planes. Lo implementa {@code infraestructura.PagosJdbc}. */
public interface RepositorioPagos {

    List<PlanVenta> planes();

    Optional<PlanVenta> planPorCodigo(String codigo);

    Optional<Pago> porClaveIdem(String claveIdem);

    Optional<Pago> porId(int id);

    Optional<Pago> porIdProveedor(String idProveedor);

    /** {@code registroJson} solo en el alta de un local con pago en proceso (datos del local y del admin, contraseña hasheada). */
    int crear(Integer localId, int planId, String claveIdem, BigDecimal monto, int meses, String emailPagador, String registroJson);

    void registrarResultado(int id, String idProveedor, String estado, String detalle, String metodo, String ultimos4, boolean borrarRegistro);

    /** Bloquea el pago si está APROBADO y sin aplicar; vacío si ya se aplicó (idempotencia). */
    Optional<Pago> bloquearParaAplicar(int id);

    void marcarAplicado(int id, int localId);

    /** Extiende o cambia el plan del local y enciende los módulos que incluye el plan nuevo. */
    void extenderPlan(int localId, int planId, Instant venceAt);

    List<Pago> historial(int localId, int limite);

    record PlanVenta(int id, String codigo, String nombre, BigDecimal precio, String descripcion, List<String> modulos) {
    }

    record Pago(int id, Integer localId, int planId, String plan, String estado, String detalle, BigDecimal monto, int meses, String metodo,
                String ultimos4, String registroJson, Instant creadoAt) {
    }
}
