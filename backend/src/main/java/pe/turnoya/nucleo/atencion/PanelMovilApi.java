package pe.turnoya.nucleo.atencion;

import java.util.Comparator;
import java.util.List;
import java.util.Set;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.SnapshotLocal;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloPersonal;

/**
 * {@code GET /api/v1/movil/panel}: lo que ve el personal en la app móvil. Solo sus ventanillas (todas si es admin), con
 * el turno que atiende cada una y quiénes siguen, y las colas donde puede emitir tickets.
 */
@RestController
@SoloPersonal
class PanelMovilApi {

    private final ConsultaTurnos consulta;
    private final CatalogoLocales locales;
    private final AccesoVentanillas acceso;

    PanelMovilApi(ConsultaTurnos consulta, CatalogoLocales locales, AccesoVentanillas acceso) {
        this.consulta = consulta;
        this.locales = locales;
        this.acceso = acceso;
    }

    @GetMapping("/api/v1/movil/panel")
    ResponseEntity<RespuestaApi<PanelMovil>> panel(@AuthenticationPrincipal Sesion sesion) {
        SnapshotLocal snap = consulta.snapshot(LocalDelPanel.resolver(sesion, null, locales), true);
        Set<Integer> permitidas = acceso.permitidas(sesion);
        List<VentanillaMovil> ventanillas = snap.ventanillas().stream()
                .filter(v -> v.cola() != null && (permitidas == null || permitidas.contains(v.id())))
                .sorted(Comparator.comparing(SnapshotLocal.VentanillaInfo::nombre))
                .map(v -> {
                    SnapshotLocal.ColaInfo cola = snap.colas().stream().filter(c -> c.id() == v.cola().id()).findFirst().orElse(null);
                    TurnoMovil actual = cola == null ? null : cola.llamados().stream()
                            .filter(l -> l.ventanillaId() != null && l.ventanillaId() == v.id())
                            .findFirst()
                            .map(l -> new TurnoMovil(l.id(), l.codigo() != null ? l.codigo() : l.codigoProvisional(), l.nombre(), l.canal().name(),
                                    l.rellamadas(), null))
                            .orElse(null);
                    List<TurnoMovil> siguientes = cola == null ? List.of() : cola.espera().stream().limit(8)
                            .map(e -> new TurnoMovil(e.id(), e.codigo() != null ? e.codigo() : e.codigoProvisional(), e.nombre(), e.canal().name(), 0,
                                    e.categoria()))
                            .toList();
                    return new VentanillaMovil(v.id(), v.nombre(), v.cola().id(), v.cola().nombre(), v.cola().prefijo(),
                            cola == null ? 0 : cola.enEspera(), cola == null ? 0 : cola.tiempoEstimadoSeg(), actual, siguientes);
                })
                .toList();
        List<ColaMovil> colasTicket = ventanillas.stream().map(v -> new ColaMovil(v.colaId(), v.cola(), v.prefijo())).distinct().toList();
        var local = snap.local();
        var datos = new PanelMovil(sesion.nombre(), sesion.rol().name(), sesion.esAdmin(), local.nombreComercial(), local.slug(),
                local.plan() == null ? null : local.plan().nombre(), local.plan() != null && local.plan().whatsappHabilitado(), ventanillas,
                colasTicket);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(RespuestaApi.ok(datos));
    }

    record PanelMovil(String usuario, String rol, boolean esAdmin, String local, String slug, String plan, boolean whatsapp,
                      List<VentanillaMovil> ventanillas, List<ColaMovil> colasTicket) {
    }

    record VentanillaMovil(int id, String nombre, int colaId, String cola, String prefijo, int enEspera, int tiempoEstimadoSeg,
                           TurnoMovil actual, List<TurnoMovil> siguientes) {
    }

    record TurnoMovil(int id, String codigo, String nombre, String canal, int rellamadas, String categoria) {
    }

    record ColaMovil(int id, String nombre, String prefijo) {
    }
}
