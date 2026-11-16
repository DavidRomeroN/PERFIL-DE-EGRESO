package pe.turnoya.notificaciones.infraestructura;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.notificaciones.dominio.GatewayOpenWa;
import tools.jackson.databind.JsonNode;

/** Cliente de la API de sesiones de OpenWA ({@code /api/sessions…}) con la clave {@code X-API-Key}. */
@Component
class OpenWaHttp implements GatewayOpenWa {

    private final PropiedadesTurnoYa.WhatsApp cfg;
    private final RestClient http;

    OpenWaHttp(PropiedadesTurnoYa propiedades) {
        this.cfg = propiedades.whatsapp();
        SimpleClientHttpRequestFactory tiempos = new SimpleClientHttpRequestFactory();
        tiempos.setConnectTimeout(Duration.ofSeconds(5));
        tiempos.setReadTimeout(Duration.ofSeconds(60));
        this.http = RestClient.builder().requestFactory(tiempos).baseUrl(url() + "/api")
                .defaultHeader("X-API-Key", cfg.openwaApiKey() == null ? "" : cfg.openwaApiKey()).build();
    }

    private String url() {
        return cfg.openwaUrl().replaceAll("/$", "");
    }

    private boolean configurado() {
        return cfg.openwaApiKey() != null && !cfg.openwaApiKey().isBlank();
    }

    @Override
    public Estado estado() {
        if (!configurado()) {
            return new Estado(false, url(), cfg.openwaSession(), false, "sin_configurar", null, null, null, null);
        }
        try {
            JsonNode s = buscarSesion();
            if (s == null) {
                return new Estado(true, url(), cfg.openwaSession(), true, "sin_sesion", null, null, null, null);
            }
            String status = s.path("status").asString("");
            String qr = "qr_ready".equals(status) ? qr(s.path("id").asString("")) : null;
            return new Estado(true, url(), cfg.openwaSession(), true, status, s.path("phone").asString(null), s.path("pushName").asString(null),
                    qr, s.path("lastError").asString(null));
        } catch (ErrorOpenWa e) {
            return new Estado(true, url(), cfg.openwaSession(), false, "sin_sesion", null, null, null, e.getMessage());
        }
    }

    @Override
    public void iniciar() {
        JsonNode s = asegurarSesion();
        String status = s.path("status").asString("");
        if (List.of("ready", "qr_ready", "initializing", "authenticating").contains(status)) {
            return;
        }
        accion(s.path("id").asString(""), "start");
    }

    @Override
    public void detener(boolean desvincular) {
        JsonNode s = buscarSesion();
        if (s != null) {
            accion(s.path("id").asString(""), desvincular ? "logout" : "stop");
        }
    }

    private void accion(String id, String accion) {
        try {
            llamar(() -> http.post().uri("/sessions/{id}/" + accion, id).retrieve().toBodilessEntity());
        } catch (ErrorOpenWa e) {
            // 400/409: la sesión ya estaba en ese estado
            if (e.status() != 400 && e.status() != 409) {
                throw e;
            }
        }
    }

    private JsonNode asegurarSesion() {
        JsonNode s = buscarSesion();
        return s != null ? s : llamar(() -> http.post().uri("/sessions").body(Map.of("name", cfg.openwaSession())).retrieve().body(JsonNode.class));
    }

    private JsonNode buscarSesion() {
        JsonNode r = llamar(() -> http.get().uri("/sessions").retrieve().body(JsonNode.class));
        JsonNode lista = r != null && r.has("data") ? r.get("data") : r;
        if (lista != null) {
            for (JsonNode s : lista) {
                if (cfg.openwaSession().equals(s.path("name").asString("")) || cfg.openwaSession().equals(s.path("id").asString(""))) {
                    return s;
                }
            }
        }
        return null;
    }

    private String qr(String id) {
        try {
            JsonNode r = http.get().uri("/sessions/{id}/qr", id).retrieve().body(JsonNode.class);
            return r == null ? null : r.path("qrCode").asString(null);
        } catch (RestClientException e) {
            return null;
        }
    }

    private static <T> T llamar(java.util.function.Supplier<T> llamada) {
        try {
            return llamada.get();
        } catch (RestClientResponseException e) {
            String mensaje = "HTTP " + e.getStatusCode().value();
            try {
                JsonNode d = e.getResponseBodyAs(JsonNode.class);
                if (d != null && d.has("message")) {
                    mensaje = d.get("message").isArray() ? d.get("message").toString() : d.get("message").asString(mensaje);
                } else if (d != null && d.has("error")) {
                    mensaje = d.get("error").asString(mensaje);
                }
            } catch (RuntimeException ignorado) {
                // cuerpo no JSON
            }
            throw new ErrorOpenWa(mensaje, e.getStatusCode().value());
        } catch (ResourceAccessException e) {
            throw new ErrorOpenWa("No se pudo conectar con OpenWA (" + e.getMessage() + ")", 502);
        }
    }
}
