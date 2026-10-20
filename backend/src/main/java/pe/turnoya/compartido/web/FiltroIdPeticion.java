package pe.turnoya.compartido.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * F6: cada petición lleva un {@code request_id} (el que envía el cliente en {@code X-Request-Id} o uno nuevo).
 * Va en todos los logs (MDC), en la respuesta y en la auditoría de la BD.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class FiltroIdPeticion extends OncePerRequestFilter {

    public static final String ATRIBUTO = "turnoya.requestId";
    private static final String CABECERA = "X-Request-Id";

    @Override
    protected void doFilterInternal(HttpServletRequest peticion, HttpServletResponse respuesta, FilterChain cadena)
            throws ServletException, IOException {
        String id = peticion.getHeader(CABECERA);
        if (id == null || id.isBlank() || id.length() > 100) {
            id = UUID.randomUUID().toString();
        }
        peticion.setAttribute(ATRIBUTO, id);
        respuesta.setHeader(CABECERA, id);
        MDC.put("request_id", id);
        try {
            cadena.doFilter(peticion, respuesta);
        } finally {
            MDC.remove("request_id");
        }
    }

    public static String de(HttpServletRequest peticion) {
        Object id = peticion.getAttribute(ATRIBUTO);
        return id == null ? "" : id.toString();
    }
}
