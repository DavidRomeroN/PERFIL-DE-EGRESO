package pe.turnoya.compartido.config;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Convierte la {@code DATABASE_URL} de legacy/ ({@code postgresql://usuario:clave@host:5432/bd?schema=public})
 * a una URL JDBC con usuario y clave aparte. Así las dos aplicaciones comparten la misma variable de entorno.
 */
public record UrlBaseDatos(String jdbcUrl, String usuario, String clave) {

    public static UrlBaseDatos desde(String databaseUrl) {
        if (databaseUrl == null || databaseUrl.isBlank()) {
            throw new IllegalStateException("DATABASE_URL no está definida. Copia .env.example a .env");
        }
        if (databaseUrl.startsWith("jdbc:")) {
            return new UrlBaseDatos(databaseUrl, null, null);
        }
        URI uri = URI.create(databaseUrl.replaceFirst("^postgres(ql)?://", "http://"));
        String usuario = null;
        String clave = null;
        if (uri.getRawUserInfo() != null) {
            String[] partes = uri.getRawUserInfo().split(":", 2);
            usuario = decodificar(partes[0]);
            clave = partes.length > 1 ? decodificar(partes[1]) : null;
        }
        int puerto = uri.getPort() > 0 ? uri.getPort() : 5432;
        List<String> parametros = new ArrayList<>();
        boolean pooler = uri.getHost().contains("-pooler");
        if (uri.getRawQuery() != null) {
            for (String par : uri.getRawQuery().split("&")) {
                String[] kv = par.split("=", 2);
                String valor = kv.length > 1 ? kv[1] : "";
                switch (kv[0]) {
                    case "schema" -> parametros.add("currentSchema=" + valor);
                    // Parámetros propios de Prisma: no aplican al driver JDBC
                    case "pgbouncer", "connection_limit", "pool_timeout", "connect_timeout" -> pooler |= kv[0].equals("pgbouncer");
                    default -> parametros.add(par);
                }
            }
        }
        // Con un pooler en modo transacción (Neon "-pooler", PgBouncer) no se pueden reutilizar sentencias preparadas
        if (pooler) {
            parametros.add("prepareThreshold=0");
        }
        String jdbc = "jdbc:postgresql://" + uri.getHost() + ":" + puerto + uri.getRawPath()
                + (parametros.isEmpty() ? "" : "?" + String.join("&", parametros));
        return new UrlBaseDatos(jdbc, usuario, clave);
    }

    private static String decodificar(String valor) {
        return URLDecoder.decode(valor, StandardCharsets.UTF_8);
    }
}
