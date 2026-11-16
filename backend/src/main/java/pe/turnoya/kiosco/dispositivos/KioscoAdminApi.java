package pe.turnoya.kiosco.dispositivos;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.kiosco.operacion.OperacionKiosco;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** {@code /api/v1/kiosco/{dispositivos,eventos}} (M5, ADMIN): kioscos del local y cola de sincronización. */
@RestController
@SoloAdmin
@RequestMapping("/api/v1/kiosco")
class KioscoAdminApi {

    private final GestionKioscos gestion;
    private final OperacionKiosco operacion;
    private final LocalDeTrabajo localDeTrabajo;
    private final Auditoria auditoria;

    KioscoAdminApi(GestionKioscos gestion, OperacionKiosco operacion, LocalDeTrabajo localDeTrabajo, Auditoria auditoria) {
        this.gestion = gestion;
        this.operacion = operacion;
        this.localDeTrabajo = localDeTrabajo;
        this.auditoria = auditoria;
    }

    @GetMapping("/dispositivos")
    RespuestaApi<List<GestionKioscos.VistaDispositivo>> listar(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        return RespuestaApi.ok(gestion.listar(localId));
    }

    @PostMapping("/dispositivos")
    ResponseEntity<RespuestaApi<GestionKioscos.Creado>> crear(@AuthenticationPrincipal Sesion sesion, @RequestBody Nuevo b, HttpServletRequest peticion) {
        return RespuestaApi.creado(gestion.crear(localDeTrabajo.resolver(sesion, peticion), b == null ? null : b.nombre(), b == null ? null : b.colaIds(),
                Auditoria.Actor.de(sesion, peticion)));
    }

    @PatchMapping("/dispositivos/{id}")
    RespuestaApi<GestionKioscos.VistaDispositivo> editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestBody Edicion b,
                                                        HttpServletRequest peticion) {
        if (b == null) {
            throw new ErrorNegocio("VALIDACION", "Sin cambios", 422);
        }
        return RespuestaApi.ok(gestion.editar(localDeTrabajo.resolver(sesion, peticion), id, b.nombre(), b.colaIds(), null, b.pin(),
                Auditoria.Actor.de(sesion, peticion)));
    }

    /** Revocar: el kiosco deja de emitir y muestra "Dispositivo no autorizado" (RN-M5-09). */
    @DeleteMapping("/dispositivos/{id}")
    RespuestaApi<GestionKioscos.VistaDispositivo> revocar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion) {
        return RespuestaApi.ok(gestion.editar(localDeTrabajo.resolver(sesion, peticion), id, null, null, false, null, Auditoria.Actor.de(sesion, peticion)));
    }

    @PostMapping("/dispositivos/{id}/rotar")
    RespuestaApi<GestionKioscos.Codigo> rotar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion) {
        return RespuestaApi.ok(gestion.rotar(localDeTrabajo.resolver(sesion, peticion), id, Auditoria.Actor.de(sesion, peticion)));
    }

    @GetMapping("/eventos")
    RespuestaApi<OperacionKiosco.Eventos> eventos(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String estado,
                                                 @RequestParam(required = false) Integer dispositivoId, @RequestParam(required = false) Long cursor,
                                                 HttpServletRequest peticion) {
        return RespuestaApi.ok(operacion.eventos(localDeTrabajo.resolver(sesion, peticion), estado, dispositivoId, cursor));
    }

    @PostMapping("/eventos/{id}/resolver")
    RespuestaApi<OperacionKiosco.Resuelto> resolver(@AuthenticationPrincipal Sesion sesion, @PathVariable long id, @RequestBody Resolver b,
                                                   HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        String accion = b == null ? null : b.accion();
        var r = operacion.resolver(localId, id, accion, sesion.sub());
        var actor = Auditoria.Actor.de(sesion, peticion);
        auditoria.registrar(actor, localId, "KIOSCO_RESOLVER", "evento_kiosco", id,
                "DESCARTAR".equals(accion) ? "Descartó un evento del kiosco" : "Emitió un turno pendiente del kiosco", Map.of("accion", accion));
        return RespuestaApi.ok(r);
    }

    record Nuevo(String nombre, List<Integer> colaIds) {
    }

    record Edicion(String nombre, List<Integer> colaIds, String pin) {
    }

    record Resolver(String accion) {
    }
}
