package pe.turnoya.prediccion.entrenamiento;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.prediccion.dominio.ModelosEspera.Tipo;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion.Config;

/**
 * {@code /admin/modulos/prediccion}: precisión del modelo por cola, comparación con la base, real vs. predicho,
 * importancia de variables, configuración y "reentrenar ahora".
 */
@Controller
@SoloAdmin
class AdminPrediccionVista {

    private static final String RUTA = "/admin/modulos/prediccion";
    static final Map<Tipo, String> NOMBRES = Map.of(Tipo.BASELINE, "Simple (personas delante × tiempo promedio)",
            Tipo.EMA, "Según lo más reciente", Tipo.ESTACIONAL, "Según el día y la hora");

    private final EntrenamientoModelos entrenamiento;
    private final ConfiguracionPrediccion configuracion;
    private final RepositorioPrediccion repositorio;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;
    private final CatalogoLocales locales;
    private final java.time.Clock reloj;

    /** Días que abarca la tarjeta "¿Cuánto esperan tus clientes?" (incluido hoy). */
    static final int DIAS_ESPERAS = 7;

    AdminPrediccionVista(EntrenamientoModelos entrenamiento, ConfiguracionPrediccion configuracion, RepositorioPrediccion repositorio,
                         LocalDeTrabajo localDeTrabajo, ModulosLocal modulos, CatalogoLocales locales, java.time.Clock reloj) {
        this.locales = locales;
        this.reloj = reloj;
        this.entrenamiento = entrenamiento;
        this.configuracion = configuracion;
        this.repositorio = repositorio;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
    }

    @GetMapping(RUTA)
    String pagina(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) Integer colaId, HttpServletRequest peticion, Model modelo) {
        int localId = local(sesion, peticion);
        var colas = repositorio.colasConNombre(localId);
        int elegida = colaId != null && colas.stream().anyMatch(c -> c.id() == colaId) ? colaId : colas.isEmpty() ? 0 : colas.getFirst().id();
        modelo.addAttribute("seccion", "M2");
        modelo.addAttribute("colas", colas);
        modelo.addAttribute("colaId", elegida);
        modelo.addAttribute("cfg", configuracion.leer(localId));
        modelo.addAttribute("nombres", nombres());
        var hoy = Fechas.fechaLocal(locales.exigir(localId).zonaHoraria(), reloj.instant());
        modelo.addAttribute("esperas", repositorio.esperasPorCola(localId, hoy, hoy.minusDays(DIAS_ESPERAS - 1)));
        modelo.addAttribute("diasEsperas", DIAS_ESPERAS);
        if (elegida > 0) {
            agregarMetricas(localId, elegida, modelo);
        }
        return "modulos/prediccion";
    }

    @PostMapping(RUTA + "/reentrenar")
    String reentrenar(@AuthenticationPrincipal Sesion sesion, @RequestParam int colaId, HttpServletRequest peticion, HttpServletResponse respuesta,
                      Model modelo) {
        int localId = local(sesion, peticion);
        var r = entrenamiento.reentrenarLocal(localId, colaId);
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:" + RUTA + "?colaId=" + colaId;
        }
        if (!r.isEmpty()) {
            var x = r.getFirst();
            Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Actualizado. Ahora se equivoca en promedio " + r1(x.maeDespuesMin()) + " min (antes " + r1(x.maeAntesMin()) + ")");
        }
        modelo.addAttribute("colaId", colaId);
        modelo.addAttribute("cfg", configuracion.leer(localId));
        modelo.addAttribute("nombres", nombres());
        agregarMetricas(localId, colaId, modelo);
        return "modulos/prediccion :: metricas";
    }

    @PostMapping(RUTA + "/config")
    ResponseEntity<Void> guardarConfig(@AuthenticationPrincipal Sesion sesion, @RequestParam String modelo, @RequestParam double alfaEma,
                                       @RequestParam double nivelConfianza, @RequestParam int diasEntrenamiento, HttpServletRequest peticion,
                                       HttpServletResponse respuesta) {
        configuracion.guardar(local(sesion, peticion), new Config(modelo, alfaEma, nivelConfianza, diasEntrenamiento), Auditoria.Actor.de(sesion, peticion));
        if (Htmx.esPeticion(peticion)) {
            Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Configuración guardada");
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.status(HttpStatus.SEE_OTHER).header(HttpHeaders.LOCATION, RUTA).build();
    }

    private void agregarMetricas(int localId, int colaId, Model modelo) {
        var m = entrenamiento.metricas(localId, colaId, 14);
        var activo = m.modelos().stream().filter(EntrenamientoModelos.ModeloInfo::activo).findFirst().orElse(null);
        var base = m.modelos().stream().filter(x -> x.tipo() == Tipo.BASELINE).findFirst().orElse(null);
        Double mejora = activo != null && activo.maeMin() != null && base != null && base.maeMin() != null && base.maeMin() > 0
                ? 1 - activo.maeMin() / base.maeMin() : null;
        modelo.addAttribute("m", m);
        modelo.addAttribute("activo", activo);
        modelo.addAttribute("mejora", mejora == null ? null : (int) Math.round(mejora * 100));
        modelo.addAttribute("grafico", grafico(m.serie()));
    }

    /** Serie real vs. predicho como SVG (banda = rango mostrado al cliente, línea = predicción, puntos = real). */
    record Grafico(String banda, String linea, List<double[]> puntos, double maximo, List<double[]> guias) {
    }

    static Grafico grafico(List<EntrenamientoModelos.Punto> serie) {
        if (serie.isEmpty()) {
            return null;
        }
        double ancho = 600;
        double alto = 220;
        double max = serie.stream().mapToDouble(p -> Math.max(p.hi(), p.real())).max().orElse(1);
        max = Math.max(5, Math.ceil(max / 5) * 5);
        double paso = serie.size() > 1 ? ancho / (serie.size() - 1) : 0;
        double escala = alto / max;
        StringBuilder arriba = new StringBuilder();
        StringBuilder abajo = new StringBuilder();
        StringBuilder linea = new StringBuilder();
        List<double[]> puntos = new ArrayList<>();
        for (int i = 0; i < serie.size(); i++) {
            var p = serie.get(i);
            double x = i * paso;
            arriba.append(fmt(x)).append(',').append(fmt(alto - p.hi() * escala)).append(' ');
            abajo.insert(0, fmt(x) + "," + fmt(alto - p.lo() * escala) + " ");
            linea.append(fmt(x)).append(',').append(fmt(alto - p.pred() * escala)).append(' ');
            puntos.add(new double[] {x, alto - p.real() * escala});
        }
        List<double[]> guias = new ArrayList<>();
        for (int k = 0; k <= 4; k++) {
            double v = max * k / 4;
            guias.add(new double[] {alto - v * escala, Math.round(v)});
        }
        return new Grafico(arriba.toString() + abajo, linea.toString().trim(), puntos, max, guias);
    }

    private static String fmt(double v) {
        return String.format(Locale.ROOT, "%.1f", v);
    }

    private static String r1(Double x) {
        return x == null ? "—" : String.format(Locale.ROOT, "%.1f", x);
    }

    private static Map<String, String> nombres() {
        Map<String, String> m = new java.util.LinkedHashMap<>();
        for (Tipo t : Tipo.values()) {
            m.put(t.name(), NOMBRES.get(t));
        }
        return m;
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modulos.exigir(localId, Modulo.M2);
        return localId;
    }
}
