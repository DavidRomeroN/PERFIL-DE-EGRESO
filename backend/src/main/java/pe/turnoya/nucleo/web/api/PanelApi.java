package pe.turnoya.nucleo.web.api;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.SnapshotLocal;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloPersonal;

/** {@code GET /api/v1/panel/estado}: foto del local del operador, con nombres (super admin: {@code ?slug=}). */
@RestController
@SoloPersonal
class PanelApi {

    private final ConsultaTurnos consulta;
    private final CatalogoLocales locales;

    PanelApi(ConsultaTurnos consulta, CatalogoLocales locales) {
        this.consulta = consulta;
        this.locales = locales;
    }

    @GetMapping("/api/v1/panel/estado")
    ResponseEntity<RespuestaApi<SnapshotLocal>> estado(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String slug) {
        Local local = localDelPanel(sesion, slug, locales);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(RespuestaApi.ok(consulta.snapshot(local, true)));
    }

    /** El operador ve su local; el super admin elige por slug o toma el primero activo. */
    static Local localDelPanel(Sesion sesion, String slug, CatalogoLocales locales) {
        if (sesion.esSuperAdmin()) {
            if (slug != null && !slug.isBlank()) {
                return locales.activoPorSlug(slug);
            }
            return locales.activos().stream().findFirst()
                    .orElseThrow(() -> new ErrorNegocio("SIN_LOCAL", "No hay locales registrados", 400));
        }
        if (sesion.localSlug() == null) {
            throw new ErrorNegocio("SIN_LOCAL", "El usuario no tiene un local asignado", 400);
        }
        return locales.activoPorSlug(sesion.localSlug());
    }
}
