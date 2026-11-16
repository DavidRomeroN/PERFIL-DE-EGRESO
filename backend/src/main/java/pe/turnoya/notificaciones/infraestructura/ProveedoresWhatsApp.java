package pe.turnoya.notificaciones.infraestructura;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.notificaciones.dominio.ProveedorWhatsApp;
import tools.jackson.databind.JsonNode;

/**
 * Crea el proveedor de WhatsApp configurado. Cada estrategia es pequeña y no conoce el dominio: recibe el celular y
 * el texto ya armado.
 */
@Configuration(proxyBeanMethods = false)
class ProveedoresWhatsApp {

    @Bean
    ProveedorWhatsApp proveedorWhatsApp(PropiedadesTurnoYa propiedades) {
        PropiedadesTurnoYa.WhatsApp cfg = propiedades.whatsapp();
        SimpleClientHttpRequestFactory tiempos = new SimpleClientHttpRequestFactory();
        tiempos.setConnectTimeout(Duration.ofSeconds(5));
        tiempos.setReadTimeout(Duration.ofSeconds(15));
        RestClient.Builder base = RestClient.builder().requestFactory(tiempos);
        return switch (cfg.proveedor().toLowerCase()) {
            case "meta" -> new Meta(cfg, base.baseUrl("https://graph.facebook.com/v20.0").build());
            case "openwa" -> new OpenWa(cfg, base.baseUrl(cfg.openwaUrl().replaceAll("/$", "") + "/api")
                    .defaultHeader("X-API-Key", cfg.openwaApiKey() == null ? "" : cfg.openwaApiKey()).build());
            default -> new Simulado();
        };
    }

    /** Simulador integrado: no envía nada real (demo y desarrollo). */
    static final class Simulado implements ProveedorWhatsApp {
        @Override
        public String nombre() {
            return "mock";
        }

        @Override
        public Resultado enviar(String telefono, String plantilla, List<String> parametros, String texto) {
            return Resultado.exito("wamid.MOCK." + Long.toString(System.currentTimeMillis(), 36));
        }
    }

    /** WhatsApp Cloud API: avisos con plantilla aprobada y respuestas del bot como texto libre. */
    static final class Meta implements ProveedorWhatsApp {
        private final PropiedadesTurnoYa.WhatsApp cfg;
        private final RestClient http;

        Meta(PropiedadesTurnoYa.WhatsApp cfg, RestClient http) {
            this.cfg = cfg;
            this.http = http;
        }

        @Override
        public String nombre() {
            return "meta";
        }

        @Override
        public Resultado enviar(String telefono, String plantilla, List<String> parametros, String texto) {
            if (cfg.token() == null || cfg.token().isBlank() || cfg.phoneNumberId() == null || cfg.phoneNumberId().isBlank()) {
                return Resultado.fallo("WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurados");
            }
            // Sin plantilla: respuesta del bot dentro de la ventana de 24 h que abrió el cliente (texto libre)
            Map<String, Object> cuerpo = plantilla == null ? Map.of(
                    "messaging_product", "whatsapp",
                    "to", telefono.replace("+", ""),
                    "type", "text",
                    "text", Map.of("body", texto)) : Map.of(
                    "messaging_product", "whatsapp",
                    "to", telefono.replace("+", ""),
                    "type", "template",
                    "template", Map.of(
                            "name", plantilla,
                            "language", Map.of("code", "es"),
                            "components", List.of(Map.of("type", "body",
                                    "parameters", parametros.stream().map(p -> Map.of("type", "text", "text", p)).toList()))));
            try {
                JsonNode r = http.post().uri("/{id}/messages", cfg.phoneNumberId())
                        .header("Authorization", "Bearer " + cfg.token())
                        .body(cuerpo).retrieve().body(JsonNode.class);
                return Resultado.exito(r == null ? null : r.path("messages").path(0).path("id").asString(null));
            } catch (RestClientException e) {
                return Resultado.fallo(e.getMessage());
            }
        }
    }

    /** Gateway OpenWA auto-hospedado: envía el texto renderizado a la sesión vinculada por QR. */
    static final class OpenWa implements ProveedorWhatsApp {
        private final PropiedadesTurnoYa.WhatsApp cfg;
        private final RestClient http;

        OpenWa(PropiedadesTurnoYa.WhatsApp cfg, RestClient http) {
            this.cfg = cfg;
            this.http = http;
        }

        @Override
        public String nombre() {
            return "openwa";
        }

        @Override
        public Resultado enviar(String telefono, String plantilla, List<String> parametros, String texto) {
            return enviarDesde(cfg.openwaSession(), telefono, plantilla, parametros, texto);
        }

        @Override
        public Resultado enviarDesde(String nombreSesion, String telefono, String plantilla, List<String> parametros, String texto) {
            try {
                JsonNode sesiones = http.get().uri("/sessions").retrieve().body(JsonNode.class);
                JsonNode lista = sesiones != null && sesiones.has("data") ? sesiones.get("data") : sesiones;
                JsonNode sesion = null;
                if (lista != null) {
                    for (JsonNode s : lista) {
                        if (nombreSesion.equals(s.path("name").asString("")) || nombreSesion.equals(s.path("id").asString(""))) {
                            sesion = s;
                        }
                    }
                }
                if (sesion == null) {
                    return Resultado.fallo("La sesión \"" + nombreSesion + "\" no existe en OpenWA: vincula el número del negocio");
                }
                if (!"ready".equals(sesion.path("status").asString(""))) {
                    return Resultado.fallo("La sesión de WhatsApp no está conectada (estado: " + sesion.path("status").asString("") + ")");
                }
                JsonNode r = http.post().uri("/sessions/{id}/messages/send-text", sesion.path("id").asString(""))
                        .body(Map.of("chatId", telefono.replaceAll("\\D", "") + "@c.us", "text", texto))
                        .retrieve().body(JsonNode.class);
                return Resultado.exito(r == null ? null : r.path("messageId").asString(null));
            } catch (RestClientException e) {
                return Resultado.fallo("No se pudo enviar por OpenWA: " + e.getMessage());
            }
        }
    }
}
