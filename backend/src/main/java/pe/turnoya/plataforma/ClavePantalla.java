package pe.turnoya.plataforma;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;

/** Clave firmada de la pantalla TV de un local ({@code ?k=}): permite mostrar el PIN de presencia sin sesión. */
@Component
public class ClavePantalla {

    private final String secreto;

    ClavePantalla(PropiedadesTurnoYa propiedades) {
        String s = propiedades.seguridad().jwtSecret();
        this.secreto = s == null || s.isBlank() ? "turnoya-dev" : s;
    }

    public String de(int localId) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secreto.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] h = mac.doFinal(("tv:" + localId).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(h).substring(0, 22);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public boolean valida(int localId, String clave) {
        return clave != null && MessageDigest.isEqual(de(localId).getBytes(StandardCharsets.UTF_8), clave.getBytes(StandardCharsets.UTF_8));
    }
}
