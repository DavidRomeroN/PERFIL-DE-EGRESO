package pe.turnoya.plataforma.dominio;

import java.math.BigDecimal;
import java.util.Map;

/**
 * Puerto de salida: la pasarela que cobra con una tarjeta ya tokenizada en el navegador (Mercado Pago, Checkout API).
 * El monto lo fija siempre el servidor. Lo implementa {@code infraestructura.MercadoPagoHttp}.
 */
public interface PasarelaPagos {

    boolean configurada();

    String clavePublica();

    Cobro cobrar(Tarjeta tarjeta, BigDecimal monto, String descripcion, String referencia, String idempotencia, String urlNotificacion);

    Cobro consultar(String idCobro);

    /** Firma {@code x-signature} del webhook; sin secreto configurado se acepta (el cobro se vuelve a consultar igual). */
    boolean firmaValida(String firma, String requestId, String dataId);

    /** Datos que entrega el Card Payment Brick en {@code onSubmit}. */
    record Tarjeta(String token, Object issuer_id, String payment_method_id, Integer installments, Pagador payer) {
    }

    record Pagador(String email, Map<String, String> identification) {
    }

    /** Respuesta de la pasarela, con el estado ya traducido a {@code EstadoPago}. */
    record Cobro(String id, String estado, String detalle, String metodo, String ultimos4, String referencia) {
    }

    /** Estados de Mercado Pago traducidos al enum {@code "EstadoPago"} de la base. */
    static String estadoDe(String status) {
        return switch (status == null ? "" : status) {
            case "approved" -> "APROBADO";
            case "authorized", "in_process" -> "EN_PROCESO";
            case "rejected" -> "RECHAZADO";
            case "cancelled" -> "CANCELADO";
            case "refunded", "charged_back" -> "REEMBOLSADO";
            default -> "PENDIENTE";
        };
    }

    /** Mensajes amigables para los motivos de rechazo más comunes. */
    static String mensajeRechazo(String detalle) {
        return switch (detalle == null ? "" : detalle) {
            case "cc_rejected_insufficient_amount" -> "La tarjeta no tiene saldo suficiente.";
            case "cc_rejected_bad_filled_security_code" -> "El código de seguridad no es correcto.";
            case "cc_rejected_bad_filled_date" -> "La fecha de vencimiento no es correcta.";
            case "cc_rejected_bad_filled_other" -> "Revisa los datos de la tarjeta.";
            case "cc_rejected_call_for_authorize" -> "Tu banco pide que autorices el pago. Llámalo y vuelve a intentar.";
            case "cc_rejected_card_disabled" -> "La tarjeta está inactiva. Actívala con tu banco.";
            case "cc_rejected_duplicated_payment" -> "Ya hiciste un pago igual hace un momento.";
            case "cc_rejected_high_risk" -> "El pago fue rechazado por seguridad. Prueba con otra tarjeta.";
            case "cc_rejected_other_reason" -> "El banco rechazó el pago. Prueba con otra tarjeta.";
            default -> detalle != null && detalle.startsWith("Mercado Pago") ? detalle : "El pago fue rechazado. Prueba con otra tarjeta.";
        };
    }
}
