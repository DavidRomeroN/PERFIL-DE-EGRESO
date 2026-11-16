package pe.turnoya.plataforma.infraestructura;

import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.plataforma.dominio.PasarelaPagos;
import tools.jackson.databind.JsonNode;

/**
 * Cliente mínimo de la API de Mercado Pago (Checkout API). El access token nunca sale del servidor.
 * En modo simulado (solo desarrollo) no llama a /v1/payments: lee el titular de la tarjeta de prueba tokenizada.
 */
@Component
class MercadoPagoHttp implements PasarelaPagos {

    private static final Logger log = LoggerFactory.getLogger(MercadoPagoHttp.class);
    private static final Map<String, String[]> SIMULACION = Map.of(
            "APRO", new String[]{"approved", "accredited"},
            "CONT", new String[]{"in_process", "pending_contingency"},
            "OTHE", new String[]{"rejected", "cc_rejected_other_reason"},
            "CALL", new String[]{"rejected", "cc_rejected_call_for_authorize"},
            "FUND", new String[]{"rejected", "cc_rejected_insufficient_amount"},
            "SECU", new String[]{"rejected", "cc_rejected_bad_filled_security_code"},
            "EXPI", new String[]{"rejected", "cc_rejected_bad_filled_date"},
            "FORM", new String[]{"rejected", "cc_rejected_bad_filled_other"});

    private final PropiedadesTurnoYa.MercadoPago cfg;
    private final RestClient http;

    MercadoPagoHttp(PropiedadesTurnoYa propiedades) {
        this.cfg = propiedades.mercadopago();
        SimpleClientHttpRequestFactory tiempos = new SimpleClientHttpRequestFactory();
        tiempos.setConnectTimeout(Duration.ofSeconds(5));
        tiempos.setReadTimeout(Duration.ofSeconds(20));
        this.http = RestClient.builder().requestFactory(tiempos).baseUrl("https://api.mercadopago.com").build();
    }

    @Override
    public boolean configurada() {
        return cfg.configurado();
    }

    @Override
    public String clavePublica() {
        return cfg.publicKey() == null ? "" : cfg.publicKey();
    }

    @Override
    public Cobro cobrar(Tarjeta t, BigDecimal monto, String descripcion, String referencia, String idempotencia, String urlNotificacion) {
        exigirConfiguracion();
        if (cfg.esSimulado()) {
            return simulado(t, referencia);
        }
        Map<String, Object> cuerpo = new LinkedHashMap<>();
        cuerpo.put("transaction_amount", monto);
        cuerpo.put("token", t.token());
        cuerpo.put("description", descripcion);
        cuerpo.put("installments", Math.max(1, Math.min(12, t.installments() == null ? 1 : t.installments())));
        cuerpo.put("payment_method_id", t.payment_method_id());
        if (t.issuer_id() != null && !t.issuer_id().toString().isBlank()) {
            cuerpo.put("issuer_id", Long.parseLong(t.issuer_id().toString()));
        }
        Map<String, Object> pagador = new LinkedHashMap<>();
        pagador.put("email", t.payer() == null ? null : t.payer().email());
        if (t.payer() != null && t.payer().identification() != null && t.payer().identification().get("number") != null) {
            pagador.put("identification", t.payer().identification());
        }
        cuerpo.put("payer", pagador);
        cuerpo.put("external_reference", referencia);
        cuerpo.put("statement_descriptor", "TURNOYA");
        if (urlNotificacion != null) {
            cuerpo.put("notification_url", urlNotificacion);
        }
        try {
            JsonNode r = http.post().uri("/v1/payments").header("Authorization", "Bearer " + cfg.accessToken())
                    .header("X-Idempotency-Key", idempotencia).body(cuerpo).retrieve().body(JsonNode.class);
            return cobro(r);
        } catch (RestClientResponseException e) {
            throw rechazo(e);
        }
    }

    @Override
    public Cobro consultar(String idCobro) {
        exigirConfiguracion();
        try {
            JsonNode r = http.get().uri("/v1/payments/{id}", idCobro).header("Authorization", "Bearer " + cfg.accessToken())
                    .retrieve().body(JsonNode.class);
            return cobro(r);
        } catch (RestClientResponseException e) {
            throw rechazo(e);
        }
    }

    @Override
    public boolean firmaValida(String firma, String requestId, String dataId) {
        String secreto = cfg.webhookSecret();
        if (secreto == null || secreto.isBlank()) {
            return true;
        }
        if (firma == null) {
            return false;
        }
        String ts = null;
        String v1 = null;
        for (String parte : firma.split(",")) {
            String[] kv = parte.trim().split("=", 2);
            if (kv.length == 2 && kv[0].equals("ts")) {
                ts = kv[1];
            } else if (kv.length == 2 && kv[0].equals("v1")) {
                v1 = kv[1];
            }
        }
        if (ts == null || v1 == null) {
            return false;
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secreto.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String manifiesto = "id:" + dataId.toLowerCase() + ";request-id:" + (requestId == null ? "" : requestId) + ";ts:" + ts + ";";
            String esperado = HexFormat.of().formatHex(mac.doFinal(manifiesto.getBytes(StandardCharsets.UTF_8)));
            return MessageDigest.isEqual(esperado.getBytes(StandardCharsets.UTF_8), v1.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return false;
        }
    }

    private void exigirConfiguracion() {
        if (!cfg.configurado()) {
            throw new ErrorNegocio("PAGOS_NO_CONFIGURADOS", "Los pagos no están configurados (falta MERCADOPAGO_ACCESS_TOKEN)", 503);
        }
    }

    /** La tarjeta sí se tokenizó en Mercado Pago; el titular de prueba (APRO, OTHE…) decide el resultado. */
    private Cobro simulado(Tarjeta t, String referencia) {
        String titular = "";
        String ultimos4 = null;
        try {
            JsonNode token = http.get().uri("/v1/card_tokens/" + URLEncoder.encode(t.token(), StandardCharsets.UTF_8) + "?public_key="
                    + URLEncoder.encode(clavePublica(), StandardCharsets.UTF_8)).retrieve().body(JsonNode.class);
            titular = token.path("cardholder").path("name").asString("").trim().toUpperCase();
            ultimos4 = token.path("last_four_digits").asString(null);
        } catch (RuntimeException e) {
            log.warn("No se pudo leer el token de la tarjeta simulada: {}", e.getMessage());
        }
        String[] resultado = SIMULACION.getOrDefault(titular, SIMULACION.get("OTHE"));
        log.warn("Pago SIMULADO (MERCADOPAGO_SIMULADO=true) referencia={} status={}", referencia, resultado[0]);
        return new Cobro(String.valueOf(System.currentTimeMillis()), PasarelaPagos.estadoDe(resultado[0]), resultado[1], t.payment_method_id(),
                ultimos4, referencia);
    }

    private static Cobro cobro(JsonNode r) {
        return new Cobro(r.path("id").asString(), PasarelaPagos.estadoDe(r.path("status").asString("")), r.path("status_detail").asString(null),
                r.path("payment_method_id").asString(null), r.path("card").path("last_four_digits").asString(null),
                r.path("external_reference").asString(null));
    }

    private static ErrorNegocio rechazo(RestClientResponseException e) {
        String detalle = "HTTP " + e.getStatusCode().value();
        try {
            JsonNode cuerpo = e.getResponseBodyAs(JsonNode.class);
            if (cuerpo != null) {
                String causa = cuerpo.path("cause").path(0).path("description").asString(null);
                detalle = causa != null ? causa : cuerpo.path("message").asString(detalle);
            }
        } catch (RuntimeException ignorado) {
            // cuerpo no JSON
        }
        log.warn("Mercado Pago rechazó la solicitud: {}", detalle);
        return new ErrorNegocio("PAGO_RECHAZADO", "Mercado Pago no aceptó el pago: " + detalle, 402);
    }
}
