package pe.turnoya.plataforma.configuracion;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Plan;
import pe.turnoya.plataforma.dominio.RepositorioLocales;
import pe.turnoya.plataforma.dominio.RepositorioLocales.DatosNegocio;
import pe.turnoya.plataforma.dominio.RepositorioLocales.DatosPantalla;
import pe.turnoya.plataforma.dominio.RepositorioLocales.UsoLocal;

/**
 * Configuración del local: datos del negocio, personalización de la pantalla (RF12) y consumo del plan.
 * Mismas validaciones que el {@code localConfigSchema} del sistema anterior.
 */
@Service
public class ConfiguracionLocal {

    private final RepositorioLocales repositorio;
    private final CatalogoLocales locales;
    private final Auditoria auditoria;
    private final Clock reloj;

    ConfiguracionLocal(RepositorioLocales repositorio, CatalogoLocales locales, Auditoria auditoria, Clock reloj) {
        this.repositorio = repositorio;
        this.locales = locales;
        this.auditoria = auditoria;
        this.reloj = reloj;
    }

    public Resumen resumen(int localId) {
        Local local = locales.exigir(localId);
        Plan plan = locales.planDe(local);
        Instant inicioMes = LocalDate.now(reloj.withZone(local.zonaHoraria())).withDayOfMonth(1).atStartOfDay(local.zonaHoraria()).toInstant();
        return new Resumen(local, repositorio.ruc(localId), plan, repositorio.uso(localId, inicioMes));
    }

    @Transactional
    public void guardarNegocio(int localId, DatosNegocio d, Auditoria.Actor actor) {
        DatosNegocio v = new DatosNegocio(
                texto(d.nombreComercial(), 2, 80, "Nombre comercial"),
                texto(d.razonSocial(), 2, 120, "Razón social"),
                opcional(d.ruc() == null ? null : d.ruc().replaceAll("\\D", ""), 11, "RUC"),
                texto(d.rubro() == null || d.rubro().isBlank() ? "Salud" : d.rubro(), 1, 40, "Rubro"),
                opcional(d.direccion(), 160, "Dirección"),
                opcional(d.telefono(), 20, "Teléfono"));
        auditoria.fijarActor(actor);
        repositorio.actualizarNegocio(localId, v);
        Map<String, Object> datos = new LinkedHashMap<>();
        datos.put("nombreComercial", v.nombreComercial());
        datos.put("razonSocial", v.razonSocial());
        datos.put("ruc", v.ruc());
        datos.put("rubro", v.rubro());
        datos.put("direccion", v.direccion());
        datos.put("telefono", v.telefono());
        auditoria.registrar(actor, localId, "EDITAR", "local", localId, "Editó los datos del negocio", datos);
    }

    @Transactional
    public void guardarPantalla(int localId, DatosPantalla d, Auditoria.Actor actor) {
        String color = d.colorPrimario() == null ? "" : d.colorPrimario().trim();
        if (!color.matches("^#[0-9a-fA-F]{6}$")) {
            throw new ErrorNegocio("VALIDACION", "Color hex inválido", 422);
        }
        String logo = opcional(d.logoUrl(), 300, "URL del logo");
        if (logo != null && !logo.matches("^https?://\\S+$")) {
            throw new ErrorNegocio("VALIDACION", "URL del logo inválida", 422);
        }
        if (d.avisarFaltando() < 0 || d.avisarFaltando() > 10) {
            throw new ErrorNegocio("VALIDACION", "Avisar cuando falten: entre 0 y 10 personas", 422);
        }
        DatosPantalla v = new DatosPantalla(color.toLowerCase(), logo, opcional(d.mensajeTv(), 200, "Mensaje de la TV"),
                opcional(d.mensajeBienvenida(), 200, "Mensaje de bienvenida"), d.avisarFaltando());
        auditoria.fijarActor(actor);
        repositorio.actualizarPantalla(localId, v);
        Map<String, Object> datos = new LinkedHashMap<>();
        datos.put("colorPrimario", v.colorPrimario());
        datos.put("logoUrl", v.logoUrl());
        datos.put("mensajeTv", v.mensajeTv());
        datos.put("mensajeBienvenida", v.mensajeBienvenida());
        datos.put("avisarFaltando", v.avisarFaltando());
        auditoria.registrar(actor, localId, "EDITAR", "local", localId, "Personalizó la pantalla TV", datos);
    }

    private static String texto(String valor, int min, int max, String campo) {
        String t = valor == null ? "" : valor.trim();
        if (t.length() < min || t.length() > max) {
            throw new ErrorNegocio("VALIDACION", campo + ": entre " + min + " y " + max + " caracteres", 422);
        }
        return t;
    }

    private static String opcional(String valor, int max, String campo) {
        if (valor == null || valor.isBlank()) {
            return null;
        }
        String t = valor.trim();
        if (t.length() > max) {
            throw new ErrorNegocio("VALIDACION", campo + ": máximo " + max + " caracteres", 422);
        }
        return t;
    }

    /** Lo que muestran las páginas de configuración y plan. */
    public record Resumen(Local local, String ruc, Plan plan, UsoLocal uso) {

        /** Como en el sistema anterior: 100 000 turnos al mes o 99 colas significan "sin límite". */
        public boolean turnosIlimitados() {
            return plan.maxTurnosMes() >= 100_000;
        }

        public boolean colasIlimitadas() {
            return plan.maxColas() >= 99;
        }

        /** Porcentaje de uso para la barra de progreso (0 a 100). */
        public int porcentaje(int usado, int limite) {
            return limite <= 0 ? 0 : Math.min(100, Math.round(usado * 100f / limite));
        }
    }
}
