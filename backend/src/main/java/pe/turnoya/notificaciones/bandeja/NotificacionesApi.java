package pe.turnoya.notificaciones.bandeja;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.notificaciones.dominio.GatewayOpenWa;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.SoloPersonal;

/** {@code /api/v1/notificaciones} (bandeja) y {@code /api/v1/whatsapp/conexion} (gateway OpenWA), como el sistema anterior. */
@RestController
class NotificacionesApi {

    private final BandejaAvisos bandeja;
    private final LocalDeTrabajo localDeTrabajo;

    NotificacionesApi(BandejaAvisos bandeja, LocalDeTrabajo localDeTrabajo) {
        this.bandeja = bandeja;
        this.localDeTrabajo = localDeTrabajo;
    }

    @SoloPersonal
    @GetMapping("/api/v1/notificaciones")
    RespuestaApi<BandejaAvisos.Bandeja> bandeja(@AuthenticationPrincipal Sesion sesion, @RequestParam(defaultValue = "60") int limit,
                                                HttpServletRequest peticion) {
        return RespuestaApi.ok(bandeja.bandeja(localDeTrabajo.resolver(sesion, peticion), limit));
    }

    @SoloAdmin
    @GetMapping("/api/v1/whatsapp/conexion")
    RespuestaApi<GatewayOpenWa.Estado> conexion() {
        return RespuestaApi.ok(bandeja.estadoConexion());
    }

    @SoloAdmin
    @PostMapping("/api/v1/whatsapp/conexion")
    RespuestaApi<GatewayOpenWa.Estado> accion(@AuthenticationPrincipal Sesion sesion, @RequestBody Map<String, String> cuerpo, HttpServletRequest peticion) {
        try {
            return RespuestaApi.ok(bandeja.accion(localDeTrabajo.resolver(sesion, peticion), cuerpo.get("accion"), cuerpo.get("telefono"),
                    Auditoria.Actor.de(sesion, peticion)));
        } catch (GatewayOpenWa.ErrorOpenWa e) {
            throw new ErrorNegocio("OPENWA", e.getMessage(), e.status() >= 400 && e.status() < 600 ? e.status() : 502);
        }
    }
}
