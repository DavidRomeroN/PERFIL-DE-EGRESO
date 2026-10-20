package pe.turnoya.compartido.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Configuración propia de TurnoYa ({@code turnoya.*} en application.yml). Los valores vienen de las mismas
 * variables de entorno que usa legacy/ (DATABASE_URL, JWT_SECRET, DATA_ENCRYPTION_KEY, WHATSAPP_*…).
 */
@ConfigurationProperties("turnoya")
public record PropiedadesTurnoYa(
        @DefaultValue("http://localhost:8080") String appUrl,
        String databaseUrl,
        @DefaultValue Seguridad seguridad,
        @DefaultValue WhatsApp whatsapp,
        @DefaultValue TiempoReal tiempoReal,
        @DefaultValue("true") boolean jobsHabilitados) {

    /** Un .env antiguo puede traer valores entre comillas ("…"): se quitan para que funcionen igual. */
    public PropiedadesTurnoYa {
        appUrl = sinComillas(appUrl);
        databaseUrl = sinComillas(databaseUrl);
    }

    static String sinComillas(String valor) {
        if (valor != null && valor.length() >= 2 && (valor.startsWith("\"") && valor.endsWith("\"") || valor.startsWith("'") && valor.endsWith("'"))) {
            return valor.substring(1, valor.length() - 1);
        }
        return valor;
    }

    /** URL pública sin la barra final (para enlaces de seguimiento y QR). */
    public String urlPublica() {
        return appUrl.endsWith("/") ? appUrl.substring(0, appUrl.length() - 1) : appUrl;
    }

    public record Seguridad(
            String jwtSecret,
            String dataEncryptionKey,
            @DefaultValue("false") boolean allowInsecureSecrets,
            @DefaultValue("false") boolean cookieSegura) {

        public Seguridad {
            jwtSecret = sinComillas(jwtSecret);
            dataEncryptionKey = sinComillas(dataEncryptionKey);
        }
    }

    public record WhatsApp(
            @DefaultValue("mock") String proveedor,
            String token,
            String phoneNumberId,
            @DefaultValue("http://localhost:2785") String openwaUrl,
            String openwaApiKey,
            @DefaultValue("turnoya") String openwaSession) {

        public WhatsApp {
            proveedor = sinComillas(proveedor);
            token = sinComillas(token);
            phoneNumberId = sinComillas(phoneNumberId);
            openwaUrl = sinComillas(openwaUrl);
            openwaApiKey = sinComillas(openwaApiKey);
            openwaSession = sinComillas(openwaSession);
        }
    }

    /** {@code memoria}: un solo proceso. {@code redis}: varias réplicas comparten los eventos en tiempo real. */
    public record TiempoReal(@DefaultValue("memoria") String bus) {
    }
}
