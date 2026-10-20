package pe.turnoya.compartido.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Ayudas para responder a htmx sin JavaScript propio.
 *
 * <p>{@link #aviso} envía el evento {@code aviso} por la cabecera {@code HX-Trigger}; {@code js/app.js} lo muestra
 * como notificación flotante. Con {@code extra} se agregan otros eventos, por ejemplo
 * {@code Map.of("sonido", true)} o {@code Map.of("abrirVentana", "/ticket/ABC")}. El servidor decide qué pasa; el
 * navegador solo lo pinta.
 */
public final class Htmx {

    private Htmx() {
    }

    public static boolean esPeticion(HttpServletRequest peticion) {
        return "true".equals(peticion.getHeader("HX-Request"));
    }

    public static void aviso(HttpServletResponse respuesta, Tipo tipo, String mensaje) {
        aviso(respuesta, tipo, mensaje, Map.of());
    }

    public static void aviso(HttpServletResponse respuesta, Tipo tipo, String mensaje, Map<String, Object> extra) {
        Map<String, Object> eventos = new LinkedHashMap<>();
        eventos.put("aviso", "{\"tipo\":\"" + tipo.name().toLowerCase() + "\",\"mensaje\":" + texto(mensaje) + "}");
        extra.forEach((k, v) -> eventos.put(k, v instanceof String s ? texto(s) : String.valueOf(v)));
        StringBuilder json = new StringBuilder("{");
        eventos.forEach((k, v) -> json.append(json.length() > 1 ? "," : "").append(texto(k)).append(':').append(v));
        respuesta.setHeader("HX-Trigger", json.append('}').toString());
    }

    /** Pide a htmx que navegue a otra URL. */
    public static void redirigir(HttpServletResponse respuesta, String url) {
        respuesta.setHeader("HX-Redirect", url);
    }

    /** Cadena JSON escapada (con comillas). Solo ASCII en la cabecera: el resto va como \\uXXXX. */
    private static String texto(String valor) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : valor.toCharArray()) {
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                default -> {
                    if (c < 0x20 || c > 0x7e) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.append('"').toString();
    }

    public enum Tipo { EXITO, INFO, ERROR }
}
