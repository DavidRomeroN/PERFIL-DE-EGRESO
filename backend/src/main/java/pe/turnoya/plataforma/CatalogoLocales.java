package pe.turnoya.plataforma;

import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.infraestructura.LocalesJdbc;

/** Consulta de locales y sus planes para el resto de módulos. */
@Service
public class CatalogoLocales {

    private final LocalesJdbc locales;

    CatalogoLocales(LocalesJdbc locales) {
        this.locales = locales;
    }

    public Optional<Local> porSlug(String slug) {
        return locales.porSlug(slug);
    }

    public Optional<Local> porId(int id) {
        return locales.porId(id);
    }

    /** Local activo con ese slug o 404 {@code LOCAL_NO_ENCONTRADO}. */
    public Local activoPorSlug(String slug) {
        return locales.porSlug(slug).filter(Local::activo)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("LOCAL_NO_ENCONTRADO", "El local no existe"));
    }

    public Local exigir(int id) {
        return locales.porId(id).orElseThrow(() -> ErrorNegocio.noEncontrado("LOCAL_NO_ENCONTRADO", "Local no encontrado"));
    }

    public List<Local> activos() {
        return locales.activos();
    }

    public Plan planDe(Local local) {
        return locales.plan(local.planId());
    }
}
