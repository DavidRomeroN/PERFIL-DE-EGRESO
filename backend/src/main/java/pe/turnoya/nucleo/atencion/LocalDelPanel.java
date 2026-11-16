package pe.turnoya.nucleo.atencion;

import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Sesion;

/** Local que muestra el panel: el operador ve el suyo; el super admin elige por slug o toma el primero activo. */
final class LocalDelPanel {

    private LocalDelPanel() {
    }

    static Local resolver(Sesion sesion, String slug, CatalogoLocales locales) {
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
