package pe.turnoya.nucleo.appmovil;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;

/**
 * Prueba de presencia de la app móvil: el QR de la app en la TV lleva una marca firmada que cambia cada 5 minutos.
 * El servidor solo acepta turnos de la app con una marca del tramo actual o del anterior, así que una foto vieja del
 * QR (o el nombre del local escrito a mano) no sirve para tomar turnos desde fuera del local.
 */
@Component
public class PresenciaApp {

    private static final long TRAMO_SEG = 300;

    private final String secreto;
    private final Clock reloj;

    PresenciaApp(PropiedadesTurnoYa propiedades, Clock reloj) {
        String s = propiedades.seguridad().jwtSecret();
        this.secreto = s == null || s.isBlank() ? "turnoya-dev" : s;
        this.reloj = reloj;
    }

    /** Marca vigente del local, para ponerla en el QR: {@code <tramo en base 36>.<firma>}. */
    public String vigente(int localId) {
        long tramo = tramoActual();
        return Long.toString(tramo, 36) + "." + firma(localId, tramo);
    }

    public boolean valida(int localId, String marca) {
        if (marca == null) {
            return false;
        }
        int punto = marca.indexOf('.');
        if (punto <= 0 || punto > 13 || marca.length() > 64) {
            return false;
        }
        long tramo;
        try {
            tramo = Long.parseLong(marca.substring(0, punto), 36);
        } catch (NumberFormatException e) {
            return false;
        }
        long actual = tramoActual();
        if (tramo != actual && tramo != actual - 1) {
            return false;
        }
        return MessageDigest.isEqual(firma(localId, tramo).getBytes(StandardCharsets.UTF_8),
                marca.substring(punto + 1).getBytes(StandardCharsets.UTF_8));
    }

    private long tramoActual() {
        return reloj.instant().getEpochSecond() / TRAMO_SEG;
    }

    private String firma(int localId, long tramo) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secreto.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] h = mac.doFinal(("app:" + localId + ":" + tramo).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(h).substring(0, 22);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
