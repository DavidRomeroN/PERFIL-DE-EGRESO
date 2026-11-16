package pe.turnoya.nucleo.pantalla;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.SnapshotLocal;
import pe.turnoya.plataforma.CatalogoLocales;

/** {@code GET /api/v1/public/locales/:slug/estado}: estado en vivo del local para la pantalla TV (sin datos personales). */
@RestController
class PantallaApi {

    private final ConsultaTurnos consulta;
    private final CatalogoLocales locales;

    PantallaApi(ConsultaTurnos consulta, CatalogoLocales locales) {
        this.consulta = consulta;
        this.locales = locales;
    }

    @GetMapping("/api/v1/public/locales/{slug}/estado")
    ResponseEntity<RespuestaApi<SnapshotLocal>> estado(@PathVariable String slug) {
        SnapshotLocal snap = consulta.snapshot(locales.activoPorSlug(slug), false);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(RespuestaApi.ok(snap));
    }
}
