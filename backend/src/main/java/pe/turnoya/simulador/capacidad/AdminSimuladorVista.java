package pe.turnoya.simulador.capacidad;

import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.simulador.dominio.SimulacionEventos;

/**
 * {@code /admin/simulador} (M8): escenario (Erlang C + simulación), comparación por número de ventanillas, validación
 * con los últimos días y escenarios guardados. Todo se calcula en el servidor; los parámetros viajan en la URL.
 */
@Controller
@SoloAdmin
class AdminSimuladorVista {

    private static final String RUTA = "/admin/simulador";

    private final Dimensionamiento dimensionamiento;
    private final CalibracionCapacidad calibracion;
    private final pe.turnoya.simulador.dominio.RepositorioSimulador repositorio;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;

    AdminSimuladorVista(Dimensionamiento dimensionamiento, CalibracionCapacidad calibracion, pe.turnoya.simulador.dominio.RepositorioSimulador repositorio,
                        LocalDeTrabajo localDeTrabajo, ModulosLocal modulos) {
        this.dimensionamiento = dimensionamiento;
        this.calibracion = calibracion;
        this.repositorio = repositorio;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
    }

    /** Columna del histograma de esperas (de 5 en 5 minutos). */
    public record Columna(String etiqueta, long n, double alto, boolean superaSla) {
    }

    /** Barra de sensibilidad: cambio del % que cumple el SLA, en puntos porcentuales. */
    public record BarraFactor(String factor, double puntos, double ancho) {
    }

    @GetMapping(RUTA)
    String pagina(@AuthenticationPrincipal Sesion sesion, @ModelAttribute("entrada") Formulario entrada, BindingResult enlace,
                  @RequestParam(defaultValue = "escenario") String tab, @RequestParam(required = false) String accion,
                  HttpServletRequest peticion, Model modelo, RedirectAttributes flash) {
        int localId = local(sesion, peticion);
        var colas = repositorio.colas(localId);
        Formulario f;
        try {
            if (enlace.hasErrors()) {
                throw new ErrorNegocio("M8_PARAMETROS_INVALIDOS", "Revisa los valores: hay un número que no se pudo leer.", 422);
            }
            f = entrada.normalizado();
        } catch (ErrorNegocio e) {
            modelo.addAttribute("error", e.getMessage());
            f = new Formulario(null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null).normalizado();
        }
        if (f.colaId() == null && !colas.isEmpty()) {
            f = new Formulario(f.lambda(), f.servicio(), f.cv(), f.c(), f.slaMin(), f.objetivo(), f.paciencia(), f.noShow(), f.replicas(), f.semilla(),
                    f.apertura(), f.cierre(), f.costoVentanilla(), f.costoEspera(), colas.getFirst().id(), false);
        }

        // Acciones que cambian los parámetros: se resuelven y se redirige para que la URL quede limpia y compartible
        if (accion != null && modelo.getAttribute("error") == null) {
            switch (accion) {
                case "menos" -> {
                    return "redirect:" + RUTA + "?tab=" + tab + "&" + f.conVentanillas(f.c() - 1).consulta();
                }
                case "mas" -> {
                    return "redirect:" + RUTA + "?tab=" + tab + "&" + f.conVentanillas(f.c() + 1).consulta();
                }
                case "quitar" -> {
                    return "redirect:" + RUTA + "?tab=" + tab + "&" + f.sinCalibrar().consulta();
                }
                case "calibrar" -> {
                    try {
                        var k = calibracion.calibrar(localId, f.colaId() == null ? 0 : f.colaId());
                        flash.addFlashAttribute("mensaje", "Parámetros cargados del histórico de " + k.cola() + ".");
                        return "redirect:" + RUTA + "?tab=escenario&" + f.calibradoCon(k).consulta();
                    } catch (ErrorNegocio e) {
                        modelo.addAttribute("error", e.getMessage());
                    }
                }
                default -> {
                }
            }
        }

        CalibracionCapacidad.Calibracion k = null;
        try {
            k = dimensionamiento.calibracionDe(localId, f);
        } catch (ErrorNegocio e) {
            modelo.addAttribute("error", e.getMessage());
            f = f.sinCalibrar();
        }
        var analitico = dimensionamiento.analitico(f);
        var parametros = dimensionamiento.parametros(localId, f, k);

        modelo.addAttribute("seccion", "M8");
        modelo.addAttribute("tab", tab);
        modelo.addAttribute("f", f);
        modelo.addAttribute("consulta", f.consulta());
        modelo.addAttribute("colas", colas);
        modelo.addAttribute("calibracion", k);
        modelo.addAttribute("analitico", analitico);
        modelo.addAttribute("ocupacionMaxima", (int) Math.round(Dimensionamiento.OCUPACION_MAXIMA * 100));
        modelo.addAttribute("diasValidacion", CalibracionCapacidad.DIAS_VALIDACION);

        if (modelo.getAttribute("error") == null && "escenario".equals(tab) && ("simular".equals(accion) || "sensibilidad".equals(accion))) {
            if ("simular".equals(accion)) {
                var sim = dimensionamiento.simular(parametros);
                modelo.addAttribute("sim", sim);
                modelo.addAttribute("histograma", histograma(sim, f.slaMin()));
            } else {
                modelo.addAttribute("tornado", tornado(dimensionamiento.sensibilidad(parametros)));
            }
        }
        switch (tab) {
            case "comparar" -> modelo.addAttribute("tabla", dimensionamiento.comparacion(f, analitico.minimo()));
            case "validacion" -> {
                if ("validar".equals(accion) && f.colaId() != null) {
                    var dias = calibracion.validar(localId, f.colaId(), parametros);
                    modelo.addAttribute("validacion", dias);
                    modelo.addAttribute("errorMedio", dias.stream().mapToDouble(CalibracionCapacidad.DiaValidado::error).average().orElse(0));
                    modelo.addAttribute("diasBuenos", dias.stream().filter(d -> d.error() <= 0.15).count());
                }
            }
            case "guardados" -> modelo.addAttribute("escenarios", dimensionamiento.escenarios(localId));
            default -> {
            }
        }
        return "modulos/simulador";
    }

    @PostMapping(RUTA + "/escenarios")
    String guardar(@AuthenticationPrincipal Sesion sesion, @ModelAttribute("entrada") Formulario entrada, BindingResult enlace,
                   @RequestParam(required = false) String nombre, HttpServletRequest peticion, RedirectAttributes flash) {
        int localId = local(sesion, peticion);
        try {
            if (enlace.hasErrors()) {
                throw new ErrorNegocio("M8_PARAMETROS_INVALIDOS", "Revisa los valores: hay un número que no se pudo leer.", 422);
            }
            Formulario f = entrada.normalizado();
            var p = dimensionamiento.parametros(localId, f, dimensionamiento.calibracionDe(localId, f));
            dimensionamiento.guardar(Auditoria.Actor.de(sesion, peticion), localId, nombre, f, dimensionamiento.simular(p));
            flash.addFlashAttribute("mensaje", "Escenario guardado");
            return "redirect:" + RUTA + "?tab=guardados&" + f.consulta();
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
            return "redirect:" + RUTA;
        }
    }

    @GetMapping(RUTA + "/escenarios/{id}")
    String abrir(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, RedirectAttributes flash) {
        try {
            Formulario f = dimensionamiento.abrir(local(sesion, peticion), id).normalizado();
            return "redirect:" + RUTA + "?tab=escenario&accion=simular&" + f.consulta();
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
            return "redirect:" + RUTA + "?tab=guardados";
        }
    }

    @PostMapping(RUTA + "/escenarios/{id}/eliminar")
    String eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, RedirectAttributes flash) {
        try {
            dimensionamiento.eliminar(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion), id);
            flash.addFlashAttribute("mensaje", "Escenario eliminado");
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        }
        return "redirect:" + RUTA + "?tab=guardados";
    }

    private static List<Columna> histograma(SimulacionEventos.MonteCarlo sim, double slaMin) {
        long[] grupos = new long[13];
        for (var b : sim.histograma()) {
            grupos[Math.min(12, b.minuto() / 5)] += b.n();
        }
        long max = 1;
        for (long g : grupos) {
            max = Math.max(max, g);
        }
        List<Columna> salida = new ArrayList<>();
        for (int i = 0; i < grupos.length; i++) {
            String etiqueta = i == 12 ? "60+" : (i * 5) + "–" + (i * 5 + 4);
            salida.add(new Columna(etiqueta, grupos[i], grupos[i] * 100.0 / max, i * 5 >= slaMin));
        }
        return salida;
    }

    private static List<BarraFactor> tornado(List<SimulacionEventos.Factor> factores) {
        double max = factores.stream().mapToDouble(x -> Math.abs(x.deltaSl())).max().orElse(0);
        return factores.stream().map(x -> new BarraFactor(x.factor(), x.deltaSl() * 100, max > 0 ? Math.abs(x.deltaSl()) / max : 0)).toList();
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modulos.exigir(localId, Modulo.M8);
        return localId;
    }
}
