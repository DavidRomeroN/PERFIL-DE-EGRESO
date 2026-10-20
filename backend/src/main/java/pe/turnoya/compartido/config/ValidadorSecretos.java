package pe.turnoya.compartido.config;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * F7: en producción (perfil {@code prod}) la aplicación no arranca con secretos ausentes, de ejemplo o de menos
 * de 32 caracteres. {@code ALLOW_INSECURE_SECRETS=true} lo permite solo para demos. Misma regla que legacy/.
 */
@Component
class ValidadorSecretos implements InitializingBean {

    private static final Logger log = LoggerFactory.getLogger(ValidadorSecretos.class);
    private static final Set<String> DE_EJEMPLO = Set.of(
            "turnoya-dev-secret-cambiar-en-produccion-2026",
            "cambia-este-secreto-en-produccion-32-chars",
            "0123456789abcdef0123456789abcdef",
            "cambia-esto-por-64-caracteres-hex-aleatorios");

    private final PropiedadesTurnoYa propiedades;
    private final Environment entorno;

    ValidadorSecretos(PropiedadesTurnoYa propiedades, Environment entorno) {
        this.propiedades = propiedades;
        this.entorno = entorno;
    }

    @Override
    public void afterPropertiesSet() {
        List<String> problemas = new ArrayList<>();
        revisar("JWT_SECRET", propiedades.seguridad().jwtSecret(), problemas);
        revisar("DATA_ENCRYPTION_KEY", propiedades.seguridad().dataEncryptionKey(), problemas);
        if (problemas.isEmpty()) {
            return;
        }
        boolean produccion = entorno.acceptsProfiles(Profiles.of("prod"));
        if (produccion && !propiedades.seguridad().allowInsecureSecrets()) {
            throw new IllegalStateException("Configuración insegura: " + String.join("; ", problemas)
                    + ". Define secretos propios en .env (ver .env.example).");
        }
        log.warn("Secretos de desarrollo: {}", problemas);
    }

    private static void revisar(String nombre, String valor, List<String> problemas) {
        if (valor == null || valor.isBlank()) {
            problemas.add(nombre + " no está definida");
        } else if (DE_EJEMPLO.contains(valor)) {
            problemas.add(nombre + " usa el valor de ejemplo");
        } else if (valor.length() < 32) {
            problemas.add(nombre + " es demasiado corta (mínimo 32 caracteres)");
        }
    }
}
