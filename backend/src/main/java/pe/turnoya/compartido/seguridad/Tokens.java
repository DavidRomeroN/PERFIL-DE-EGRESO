package pe.turnoya.compartido.seguridad;

import java.security.SecureRandom;

/** Tokens públicos (enlaces /t/:token): sin caracteres ambiguos (0/O, 1/I/L), como en legacy/. */
public final class Tokens {

    private static final String ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom ALEATORIO = new SecureRandom();

    private Tokens() {
    }

    public static String generar(int longitud) {
        byte[] bytes = new byte[longitud];
        ALEATORIO.nextBytes(bytes);
        StringBuilder sb = new StringBuilder(longitud);
        for (byte b : bytes) {
            // El alfabeto tiene 32 símbolos: el módulo no introduce sesgo
            sb.append(ALFABETO.charAt(Byte.toUnsignedInt(b) % ALFABETO.length()));
        }
        return sb.toString();
    }
}
