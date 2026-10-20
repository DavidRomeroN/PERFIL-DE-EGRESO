package pe.turnoya.nucleo.web.api;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.SnapshotLocal;
import pe.turnoya.nucleo.aplicacion.InformacionLocal;
import pe.turnoya.plataforma.CatalogoLocales;

/** Información pública del local y su estado en vivo (pantalla TV). */
@RestController
@RequestMapping("/api/v1/public/locales/{slug}")
class LocalesPublicosApi {

    private final InformacionLocal informacion;
    private final ConsultaTurnos consulta;
    private final CatalogoLocales locales;

    LocalesPublicosApi(InformacionLocal informacion, ConsultaTurnos consulta, CatalogoLocales locales) {
        this.informacion = informacion;
        this.consulta = consulta;
        this.locales = locales;
    }

    @GetMapping
    RespuestaApi<InformacionLocal.LocalParaCliente> local(@PathVariable String slug) {
        return RespuestaApi.ok(informacion.porSlug(slug));
    }

    @GetMapping("/estado")
    ResponseEntity<RespuestaApi<SnapshotLocal>> estado(@PathVariable String slug) {
        SnapshotLocal snap = consulta.snapshot(locales.activoPorSlug(slug), false);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(RespuestaApi.ok(snap));
    }
}
