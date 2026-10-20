package pe.turnoya.compartido;

import java.util.Map;

/**
 * Error de negocio con código estable. La API lo traduce a {@code {ok:false, error:{codigo, mensaje, ...extra}}}
 * con el estado HTTP indicado, igual que el sistema anterior; las vistas lo muestran como mensaje al usuario.
 */
public class ErrorNegocio extends RuntimeException {

    private final String codigo;
    private final int status;
    private final Map<String, Object> extra;

    public ErrorNegocio(String codigo, String mensaje) {
        this(codigo, mensaje, 400, Map.of());
    }

    public ErrorNegocio(String codigo, String mensaje, int status) {
        this(codigo, mensaje, status, Map.of());
    }

    public ErrorNegocio(String codigo, String mensaje, int status, Map<String, Object> extra) {
        super(mensaje);
        this.codigo = codigo;
        this.status = status;
        // Copia que admite valores nulos (p. ej. proximaApertura cuando no hay horario)
        this.extra = java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(extra));
    }

    public static ErrorNegocio noEncontrado(String codigo, String mensaje) {
        return new ErrorNegocio(codigo, mensaje, 404);
    }

    public static ErrorNegocio conflicto(String codigo, String mensaje) {
        return new ErrorNegocio(codigo, mensaje, 409);
    }

    public static ErrorNegocio prohibido(String codigo, String mensaje) {
        return new ErrorNegocio(codigo, mensaje, 403);
    }

    public String codigo() {
        return codigo;
    }

    public int status() {
        return status;
    }

    public Map<String, Object> extra() {
        return extra;
    }
}
