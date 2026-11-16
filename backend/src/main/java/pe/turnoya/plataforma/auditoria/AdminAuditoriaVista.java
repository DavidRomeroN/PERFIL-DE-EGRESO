package pe.turnoya.plataforma.auditoria;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.ResponseBody;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** Página de auditoría: filtros que recargan la tabla con htmx y paginación hacia eventos más antiguos. */
@Controller
@SoloAdmin
class AdminAuditoriaVista {

    private final ConsultaAuditoria consulta;
    private final LocalDeTrabajo localDeTrabajo;

    AdminAuditoriaVista(ConsultaAuditoria consulta, LocalDeTrabajo localDeTrabajo) {
        this.consulta = consulta;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/admin/auditoria")
    String pagina(@AuthenticationPrincipal Sesion sesion, @ModelAttribute("filtros") Formulario f, HttpServletRequest peticion, Model modelo) {
        modelo.addAttribute("seccion", "auditoria");
        modelo.addAttribute("pagina", consulta.pagina(localDeTrabajo.resolver(sesion, peticion), f.filtros()));
        return Htmx.esPeticion(peticion) ? "admin/auditoria :: tabla" : "admin/auditoria";
    }

    @GetMapping("/admin/auditoria.csv")
    @ResponseBody
    ResponseEntity<byte[]> csv(@AuthenticationPrincipal Sesion sesion, @ModelAttribute Formulario f, HttpServletRequest peticion) {
        return consulta.csv(localDeTrabajo.resolver(sesion, peticion), f.filtros());
    }

    /** Parámetros de la URL, tal cual los envía el formulario de filtros. */
    record Formulario(@DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate desde, @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate hasta,
                      String accion, String entidad, String texto, String requestId, Long cursor) {

        ConsultaAuditoria.Filtros filtros() {
            return new ConsultaAuditoria.Filtros(desde, hasta, accion, entidad, texto, requestId, cursor);
        }

        /** Consulta sin el cursor, para los enlaces de CSV, "Inicio" y "Más antiguos". */
        public String consulta() {
            StringBuilder qs = new StringBuilder();
            agregar(qs, "desde", desde);
            agregar(qs, "hasta", hasta);
            agregar(qs, "accion", accion);
            agregar(qs, "entidad", entidad);
            agregar(qs, "texto", texto);
            agregar(qs, "requestId", requestId);
            return qs.toString();
        }

        private static void agregar(StringBuilder qs, String nombre, Object valor) {
            if (valor != null && !valor.toString().isBlank()) {
                qs.append(qs.isEmpty() ? "" : "&").append(nombre).append('=').append(URLEncoder.encode(valor.toString(), StandardCharsets.UTF_8));
            }
        }
    }
}
