package pe.turnoya.compartido.seguridad;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;

/**
 * Cifrado de datos personales (Ley N.° 29733) compatible con legacy/ ({@code backend/src/crypto.ts}).
 *
 * <p>Formato guardado: {@code base64(iv) . base64(tag) . base64(cifrado)} con AES-256-GCM, IV de 12 bytes y tag de
 * 16. Java espera el tag pegado al final del cifrado, así que se separa y se une aquí. La clave es la
 * {@code DATA_ENCRYPTION_KEY} en hexadecimal (64 caracteres) o, si no lo es, el SHA-256 del texto.
 */
@Component
public class CifradoDatos {

    private static final String ALGORITMO = "AES/GCM/NoPadding";
    private static final int BITS_TAG = 128;
    private static final int BYTES_IV = 12;
    /** Clave de desarrollo de legacy/ cuando no hay DATA_ENCRYPTION_KEY (nunca en producción: lo impide ValidadorSecretos). */
    private static final String CLAVE_POR_DEFECTO = "0123456789abcdef0123456789abcdef";

    private final SecretKeySpec clave;
    private final SecureRandom aleatorio = new SecureRandom();

    /** Constructor que usa Spring; el que recibe el texto de la clave es para las pruebas. */
    @Autowired
    public CifradoDatos(PropiedadesTurnoYa propiedades) {
        this(propiedades.seguridad().dataEncryptionKey());
    }

    public CifradoDatos(String claveConfigurada) {
        this.clave = new SecretKeySpec(derivarClave(claveConfigurada), "AES");
    }

    static byte[] derivarClave(String configurada) {
        String raw = configurada == null || configurada.isBlank() ? CLAVE_POR_DEFECTO : configurada;
        if (raw.matches("^[0-9a-fA-F]{64}$")) {
            return HexFormat.of().parseHex(raw);
        }
        return sha256(raw.getBytes(StandardCharsets.UTF_8));
    }

    public String cifrar(String texto) {
        try {
            byte[] iv = new byte[BYTES_IV];
            aleatorio.nextBytes(iv);
            Cipher cipher = Cipher.getInstance(ALGORITMO);
            cipher.init(Cipher.ENCRYPT_MODE, clave, new GCMParameterSpec(BITS_TAG, iv));
            byte[] salida = cipher.doFinal(texto.getBytes(StandardCharsets.UTF_8));
            int largoCifrado = salida.length - BITS_TAG / 8;
            byte[] cifrado = java.util.Arrays.copyOfRange(salida, 0, largoCifrado);
            byte[] tag = java.util.Arrays.copyOfRange(salida, largoCifrado, salida.length);
            Base64.Encoder b64 = Base64.getEncoder();
            return b64.encodeToString(iv) + "." + b64.encodeToString(tag) + "." + b64.encodeToString(cifrado);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("No se pudo cifrar", e);
        }
    }

    /** Vacío si el texto no tiene el formato esperado o fue cifrado con otra clave. */
    public Optional<String> descifrar(String guardado) {
        if (guardado == null) {
            return Optional.empty();
        }
        try {
            String[] partes = guardado.split("\\.");
            if (partes.length != 3) {
                return Optional.empty();
            }
            Base64.Decoder b64 = Base64.getDecoder();
            byte[] iv = b64.decode(partes[0]);
            byte[] tag = b64.decode(partes[1]);
            byte[] cifrado = b64.decode(partes[2]);
            byte[] entrada = new byte[cifrado.length + tag.length];
            System.arraycopy(cifrado, 0, entrada, 0, cifrado.length);
            System.arraycopy(tag, 0, entrada, cifrado.length, tag.length);
            Cipher cipher = Cipher.getInstance(ALGORITMO);
            cipher.init(Cipher.DECRYPT_MODE, clave, new GCMParameterSpec(tag.length * 8, iv));
            return Optional.of(new String(cipher.doFinal(entrada), StandardCharsets.UTF_8));
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    static byte[] sha256(byte[] datos) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(datos);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
