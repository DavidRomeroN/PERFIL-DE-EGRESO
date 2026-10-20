package pe.turnoya.nucleo.web.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.aplicacion.GestionVentanillas;
import pe.turnoya.nucleo.aplicacion.OperacionVentanilla;
import pe.turnoya.nucleo.dominio.Ventanilla;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.SoloPersonal;

/** {@code /api/v1/ventanillas} y la acción principal del operador: llamar al siguiente (RF05). */
@RestController
@RequestMapping("/api/v1/ventanillas")
class VentanillasApi {

    private final GestionVentanillas ventanillas;
    private final OperacionVentanilla operacion;
    private final LocalDeTrabajo localDeTrabajo;

    VentanillasApi(GestionVentanillas ventanillas, OperacionVentanilla operacion, LocalDeTrabajo localDeTrabajo) {
        this.ventanillas = ventanillas;
        this.operacion = operacion;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping
    @SoloPersonal
    RespuestaApi<List<GestionVentanillas.VentanillaAdmin>> listar(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(ventanillas.listar(localDeTrabajo.resolver(sesion, peticion)));
    }

    @PostMapping
    @SoloAdmin
    ResponseEntity<RespuestaApi<Ventanilla>> crear(@Valid @RequestBody GestionVentanillas.DatosVentanilla datos,
                                                   @AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.creado(ventanillas.crear(localDeTrabajo.resolver(sesion, peticion), datos, Auditoria.Actor.de(sesion, peticion)));
    }

    @PatchMapping("/{id}")
    @SoloAdmin
    RespuestaApi<Ventanilla> editar(@PathVariable int id, @Valid @RequestBody GestionVentanillas.CambiosVentanilla cambios,
                                    @AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(ventanillas.editar(localDeTrabajo.resolver(sesion, peticion), id, cambios, Auditoria.Actor.de(sesion, peticion)));
    }

    @DeleteMapping("/{id}")
    @SoloAdmin
    RespuestaApi<Map<String, Object>> eliminar(@PathVariable int id, @AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(ventanillas.eliminar(localDeTrabajo.resolver(sesion, peticion), id, Auditoria.Actor.de(sesion, peticion)));
    }

    @PostMapping("/{id}/llamar-siguiente")
    @SoloPersonal
    RespuestaApi<Map<String, Object>> llamarSiguiente(@PathVariable int id, @AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        Optional<TurnoPublico> turno = operacion.llamarSiguiente(id, localDeTrabajo.resolver(sesion, peticion), Auditoria.Actor.de(sesion, peticion));
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("turno", turno.orElse(null));
        data.put("vacia", turno.isEmpty());
        return RespuestaApi.ok(data);
    }
}
