package pe.turnoya.prioridades.configuracion;

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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.prioridades.dominio.ReglasPrioridad.Config;
import pe.turnoya.prioridades.dominio.ReglasPrioridad.Simulacion;
import pe.turnoya.prioridades.dominio.ReglasPrioridad.TurnoSimulado;
import pe.turnoya.prioridades.dominio.RepositorioPrioridades.CategoriaFila;

/** {@code /api/v1/prioridades} (M1), mismo contrato que el sistema anterior. 403 {@code MODULO_NO_DISPONIBLE} si M1 está apagado. */
@RestController
@SoloAdmin
@RequestMapping("/api/v1/prioridades")
class PrioridadesApi {

    private final GestionPrioridades gestion;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;

    PrioridadesApi(GestionPrioridades gestion, LocalDeTrabajo localDeTrabajo, ModulosLocal modulos) {
        this.gestion = gestion;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
    }

    @GetMapping
    RespuestaApi<GestionPrioridades.Prioridades> listar(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(gestion.listar(local(sesion, peticion)));
    }

    @PutMapping("/config")
    RespuestaApi<Map<String, Integer>> config(@AuthenticationPrincipal Sesion sesion, @RequestBody ConfigJson b, HttpServletRequest peticion) {
        return RespuestaApi.ok(gestion.guardarConfig(local(sesion, peticion), b.config(), Auditoria.Actor.de(sesion, peticion)));
    }

    @PostMapping("/categorias")
    ResponseEntity<RespuestaApi<CategoriaFila>> crear(@AuthenticationPrincipal Sesion sesion, @RequestBody GestionPrioridades.NuevaCategoria b,
                                                      HttpServletRequest peticion) {
        return RespuestaApi.creado(gestion.crear(local(sesion, peticion), b, Auditoria.Actor.de(sesion, peticion)));
    }

    @PatchMapping("/categorias/{id}")
    RespuestaApi<CategoriaFila> editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestBody GestionPrioridades.CambioCategoria b,
                                       HttpServletRequest peticion) {
        return RespuestaApi.ok(gestion.editar(local(sesion, peticion), id, b, Auditoria.Actor.de(sesion, peticion)));
    }

    @DeleteMapping("/categorias/{id}")
    RespuestaApi<Map<String, Boolean>> eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion) {
        return RespuestaApi.ok(gestion.eliminar(local(sesion, peticion), id, Auditoria.Actor.de(sesion, peticion)));
    }

    @PostMapping("/simular")
    RespuestaApi<Simulacion> simular(@AuthenticationPrincipal Sesion sesion, @RequestBody SimularJson b, HttpServletRequest peticion) {
        return RespuestaApi.ok(gestion.simular(local(sesion, peticion), b.config() == null ? null : b.config().config(), b.turnos(), b.pesos()));
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modulos.exigir(localId, Modulo.M1);
        return localId;
    }

    record ConfigJson(Double alfaPuntosPorMin, Integer topeAdelantos, Boolean agingActivo) {
        Config config() {
            return new Config(alfaPuntosPorMin == null ? 0 : alfaPuntosPorMin, topeAdelantos == null ? 0 : topeAdelantos, Boolean.TRUE.equals(agingActivo));
        }
    }

    record SimularJson(ConfigJson config, List<TurnoSimulado> turnos, Map<String, Integer> pesos) {
    }
}
