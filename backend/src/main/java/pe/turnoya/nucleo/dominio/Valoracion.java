package pe.turnoya.nucleo.dominio;

import java.time.Instant;

/** Valoración de la atención (N07): 1 a 5 estrellas y un comentario opcional, una por turno atendido. */
public record Valoracion(int id, int turnoId, int estrellas, String comentario, Instant createdAt) {

    /** Sin caracteres de control ni etiquetas, máximo 280 caracteres. Nulo si queda vacío. */
    public static String limpiarComentario(String comentario) {
        if (comentario == null) {
            return null;
        }
        String s = comentario.replaceAll("[\\u0000-\\u001f<>]", " ").trim();
        if (s.isEmpty()) {
            return null;
        }
        return s.length() > 280 ? s.substring(0, 280) : s;
    }
}
