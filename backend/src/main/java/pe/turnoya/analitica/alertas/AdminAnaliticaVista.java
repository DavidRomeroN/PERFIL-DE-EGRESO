package pe.turnoya.analitica.alertas;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;
import org.springframework.web.util.UriComponentsBuilder;
import pe.turnoya.analitica.tablero.ConsultasAnalitica;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** {@code /admin/analitica}: KPIs, SLA por cola, mapa de calor y percentiles; alertas activas, reglas e historial. */
@Controller
@SoloAdmin
class AdminAnaliticaVista {

    private static final String RUTA = "/admin/analitica";

    private final ConsultasAnalitica consultas;
    private final MotorAlertas motor;
    private final ReglasDeAlerta reglas;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;
    private final Clock reloj;

    AdminAnaliticaVista(ConsultasAnalitica consultas, MotorAlertas motor, ReglasDeAlerta reglas, LocalDeTrabajo localDeTrabajo, ModulosLocal modulos, Clock reloj) {
        this.consultas = consultas;
        this.motor = motor;
        this.reglas = reglas;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
        this.reloj = reloj;
    }

    @GetMapping(RUTA)
    String pagina(@AuthenticationPrincipal Sesion sesion, @RequestParam(defaultValue = "analitica") String tab, @RequestParam(required = false) String desde,
                  @RequestParam(required = false) String hasta, @RequestParam(defaultValue = "llegadas") String metrica, HttpServletRequest peticion, Model modelo) {
        int localId = local(sesion, peticion);
        modelo.addAttribute("seccion", "M7");
        modelo.addAttribute("tab", tab);
        var activas = motor.listar(localId, List.of("ABIERTA", "RECONOCIDA", "SILENCIADA"), null, null).items();
        modelo.addAttribute("abiertas", activas.stream().filter(a -> "ABIERTA".equals(a.estado())).count());
        if ("alertas".equals(tab)) {
            modelo.addAttribute("activas", activas);
            modelo.addAttribute("historial", motor.listar(localId, List.of("RESUELTA"), null, null).items().stream().limit(20).toList());
            modelo.addAttribute("reglas", reglas.listar(localId));
            return "modulos/analitica";
        }
        ConsultasAnalitica.Rango r;
        try {
            r = consultas.rango(localId, desde, hasta);
        } catch (ErrorNegocio e) {
            modelo.addAttribute("error", e.getMessage());
            r = consultas.rango(localId, null, null);
        }
        var porHora = consultas.percentiles(localId, r, null, "hora");
        modelo.addAttribute("rango", r);
        modelo.addAttribute("metrica", metrica);
        modelo.addAttribute("resumen", consultas.resumen(localId, r, null));
        modelo.addAttribute("calor", consultas.mapaDeCalor(localId, r, null, List.of("llegadas", "espera_p90", "abandono").contains(metrica) ? metrica : "llegadas"));
        modelo.addAttribute("porHora", porHora);
        modelo.addAttribute("maxHora", porHora.stream().map(p -> p.espera().p90()).filter(x -> x != null).mapToDouble(Double::doubleValue).max().orElse(1));
        return "modulos/analitica";
    }

    @PostMapping(RUTA + "/sla/{colaId}")
    String sla(@AuthenticationPrincipal Sesion sesion, @PathVariable int colaId, @RequestParam Integer esperaMaxMin, @RequestParam Double objetivoPct,
               @RequestParam(defaultValue = "60") Integer ventanaMin, @RequestParam(defaultValue = "false") boolean activo, HttpServletRequest peticion,
               RedirectAttributes flash) {
        try {
            consultas.guardarSla(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion), colaId, esperaMaxMin, objetivoPct, ventanaMin, activo);
            flash.addFlashAttribute("mensaje", "SLA guardado");
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        }
        return "redirect:" + RUTA;
    }

    @PostMapping(RUTA + "/alertas/{id}/accion")
    String accion(@AuthenticationPrincipal Sesion sesion, @PathVariable long id, @RequestParam String accion, HttpServletRequest peticion,
                  RedirectAttributes flash) {
        try {
            var hasta = "SILENCIAR".equals(accion) ? reloj.instant().plus(Duration.ofHours(1)) : null;
            motor.accion(local(sesion, peticion), id, accion, sesion.sub(), hasta);
            flash.addFlashAttribute("mensaje", switch (accion) {
                case "RECONOCER" -> "Alerta reconocida: ya no escalará";
                case "SILENCIAR" -> "Alerta silenciada por 1 hora";
                case "REABRIR" -> "Alerta reabierta";
                default -> "Alerta resuelta";
            });
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        }
        return "redirect:" + RUTA + "?tab=alertas";
    }

    @PostMapping(RUTA + "/reglas/{id}/activa")
    String activa(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam boolean activa, HttpServletRequest peticion,
                  RedirectAttributes flash) {
        reglas.editar(local(sesion, peticion), id, new ReglasDeAlerta.Datos(null, null, null, null, null, activa, null, false));
        flash.addFlashAttribute("mensaje", activa ? "Regla activada" : "Regla desactivada");
        return "redirect:" + RUTA + "?tab=alertas";
    }

    @PostMapping(RUTA + "/reglas/{id}/umbral")
    String umbral(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam String clave, @RequestParam double valor,
                  HttpServletRequest peticion, RedirectAttributes flash) {
        int localId = local(sesion, peticion);
        try {
            var actual = reglas.listar(localId).stream().filter(r -> r.id() == id).findFirst()
                    .orElseThrow(() -> new ErrorNegocio("M7_REGLA_INVALIDA", "La regla no existe", 404));
            var umbral = new java.util.LinkedHashMap<>(actual.umbral());
            if (!umbral.containsKey(clave)) {
                throw new ErrorNegocio("VALIDACION", "Umbral inválido", 422);
            }
            umbral.put(clave, valor);
            reglas.editar(localId, id, new ReglasDeAlerta.Datos(null, null, umbral, null, null, null, null, false));
            flash.addFlashAttribute("mensaje", "Umbral actualizado");
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        }
        return "redirect:" + RUTA + "?tab=alertas";
    }

    @GetMapping(RUTA + "/percentiles.csv")
    ResponseEntity<byte[]> csv(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String desde, @RequestParam(required = false) String hasta,
                               HttpServletRequest peticion) {
        int localId = local(sesion, peticion);
        var filas = consultas.percentiles(localId, consultas.rango(localId, desde, hasta), null, "cola");
        StringBuilder sb = new StringBuilder("cola,n,espera_p50,espera_p90,espera_p95,atencion_p50,atencion_p90\n");
        for (var p : filas) {
            sb.append('"').append(p.grupo().replace("\"", "\"\"")).append('"').append(',').append(p.n()).append(',').append(v(p.espera().p50())).append(',')
                    .append(v(p.espera().p90())).append(',').append(v(p.espera().p95())).append(',').append(v(p.atencion().p50())).append(',')
                    .append(v(p.atencion().p90())).append('\n');
        }
        String nombre = UriComponentsBuilder.newInstance().path("percentiles.csv").build().toString();
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + nombre + "\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8)).body(sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String v(Double d) {
        return d == null ? "" : String.valueOf(d);
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modulos.exigir(localId, Modulo.M7);
        return localId;
    }
}
