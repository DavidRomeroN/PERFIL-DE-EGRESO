package pe.turnoya.compartido.web;

import jakarta.servlet.http.HttpServletRequest;

/** IP del cliente detrás de un proxy (primer valor de X-Forwarded-For), como en legacy/. */
public final class IpCliente {

    private IpCliente() {
    }

    public static String de(HttpServletRequest peticion) {
        String reenviado = peticion.getHeader("X-Forwarded-For");
        if (reenviado != null && !reenviado.isBlank()) {
            return reenviado.split(",")[0].trim();
        }
        String real = peticion.getHeader("X-Real-IP");
        if (real != null && !real.isBlank()) {
            return real;
        }
        return peticion.getRemoteAddr() == null ? "local" : peticion.getRemoteAddr();
    }
}
