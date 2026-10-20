package pe.turnoya.compartido.seguridad;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.Optional;

/**
 * Celulares: normalización a E.164, hash para búsquedas y máscara para mostrar.
 *
 * <p>Debe dar exactamente los mismos resultados que legacy/: el hash es la clave del índice único
 * {@code ux_cliente_telefono_hash} (un celular = un cliente) y de la regla RN03.
 */
public final class Telefonos {

    private Telefonos() {
    }

    /** Normaliza un celular peruano a +51XXXXXXXXX. Vacío si no es válido. */
    public static Optional<String> normalizar(String entrada) {
        if (entrada == null) {
            return Optional.empty();
        }
        String digitos = entrada.replaceAll("\\D", "");
        if (digitos.isEmpty()) {
            return Optional.empty();
        }
        if (digitos.length() == 9 && digitos.startsWith("9")) {
            return Optional.of("+51" + digitos);
        }
        if (digitos.length() == 11 && digitos.startsWith("51")) {
            return Optional.of("+" + digitos);
        }
        if (digitos.length() >= 10 && digitos.length() <= 15) {
            return Optional.of("+" + digitos);
        }
        return Optional.empty();
    }

    /** SHA-256 en hexadecimal del número ya normalizado. */
    public static String hash(String telefonoE164) {
        return HexFormat.of().formatHex(CifradoDatos.sha256(telefonoE164.getBytes(StandardCharsets.UTF_8)));
    }

    /** +51987654321 → "+51 9** *** 321". */
    public static String enmascarar(String telefonoE164) {
        String d = telefonoE164.replaceAll("\\D", "");
        if (d.length() < 7) {
            return "***";
        }
        // Igual que d.slice(0, d.length - 9) en JavaScript: un fin negativo cuenta desde el final
        int fin = d.length() - 9;
        String pais = d.substring(0, fin >= 0 ? fin : Math.max(0, d.length() + fin));
        String numero = d.substring(Math.max(0, d.length() - 9));
        return "+" + pais + " " + numero.charAt(0) + "** *** " + numero.substring(numero.length() - 3);
    }
}
