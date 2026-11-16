package pe.turnoya.balanceo.reglas;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
import pe.turnoya.balanceo.transferencias.Transferencias;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** {@code /admin/modulos/balanceo}: carga en vivo, reglas (simulación/activas), historial con confirmaciones y transferencias. */
@Controller
@SoloAdmin
class AdminBalanceoVista {

    private static final String RUTA = "/admin/modulos/balanceo";

    private final GestionReglas reglas;
    private final EvaluadorBalanceo evaluador;
    private final MetricasBalanceo metricas;
    private final Transferencias transferencias;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;

    AdminBalanceoVista(GestionReglas reglas, EvaluadorBalanceo evaluador, MetricasBalanceo metricas, Transferencias transferencias,
                       LocalDeTrabajo localDeTrabajo, ModulosLocal modulos) {
        this.reglas = reglas;
        this.evaluador = evaluador;
        this.metricas = metricas;
        this.transferencias = transferencias;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
    }

    @GetMapping(RUTA)
    String pagina(@AuthenticationPrincipal Sesion sesion, @RequestParam(defaultValue = "carga") String tab, HttpServletRequest peticion, Model modelo) {
        int localId = local(sesion, peticion);
        var carga = metricas.carga(localId);
        modelo.addAttribute("seccion", "M6");
        modelo.addAttribute("tab", tab);
        modelo.addAttribute("carga", carga);
        modelo.addAttribute("metricas", GestionReglas.METRICAS);
        var ejecuciones = evaluador.ejecuciones(localId, null, "PENDIENTE_CONFIRMACION", null).items();
        modelo.addAttribute("pendientes", ejecuciones.size());
        switch (tab) {
            case "reglas" -> modelo.addAttribute("reglas", reglas.listar(localId));
            case "historial" -> modelo.addAttribute("ejecuciones", evaluador.ejecuciones(localId, null, null, null).items());
            case "transferencias" -> modelo.addAttribute("transferencias", transferencias.historial(localId, null, null, null).items());
            default -> {
            }
        }
        modelo.addAttribute("nombresMotivo", Transferencias.NOMBRES_MOTIVO);
        return "modulos/balanceo";
    }

    @PostMapping(RUTA + "/balancear")
    String balancear(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, RedirectAttributes flash) {
        var r = evaluador.balancearAhora(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion));
        flash.addFlashAttribute("mensaje", r.movido() ? "Se movió " + r.ventanilla() + " a la cola con más espera" : "La carga ya está equilibrada");
        return "redirect:" + RUTA;
    }

    @PostMapping(RUTA + "/reglas")
    String crear(@AuthenticationPrincipal Sesion sesion, @RequestParam String nombre, @RequestParam String metrica, @RequestParam(required = false) Integer cola,
                 @RequestParam String op, @RequestParam double valor, @RequestParam(defaultValue = "MOVER_OPERADOR") String tipo,
                 @RequestParam(required = false) Integer desde, @RequestParam(required = false) Integer hacia,
                 @RequestParam(defaultValue = "3") int cantidad, @RequestParam(required = false) String mensaje,
                 @RequestParam(defaultValue = "5") int forMin, @RequestParam(defaultValue = "10") int cooldownMin,
                 @RequestParam(defaultValue = "20") int histeresis, @RequestParam(defaultValue = "false") boolean confirmar,
                 HttpServletRequest peticion, RedirectAttributes flash) {
        try {
            Map<String, Object> condicion = new LinkedHashMap<>();
            condicion.put("metric", metrica);
            if (cola != null && !"espera_prom_local".equals(metrica)) {
                condicion.put("scope", Map.of("cola", cola));
            }
            condicion.put("op", op);
            condicion.put("value", valor);
            Map<String, Object> accion = new LinkedHashMap<>();
            accion.put("tipo", tipo);
            switch (tipo) {
                case "DERIVAR_TURNOS" -> {
                    accion.put("deColaId", desde);
                    accion.put("aColaId", hacia);
                    accion.put("cantidad", cantidad);
                }
                case "NOTIFICAR" -> accion.put("mensaje", mensaje == null ? "" : mensaje.trim());
                default -> {
                    accion.put("desdeColaId", desde);
                    accion.put("haciaColaId", hacia);
                }
            }
            reglas.crear(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion), new GestionReglas.Entrada(nombre, condicion, accion, forMin * 60, null,
                    Math.max(120, cooldownMin * 60), histeresis, null, confirmar, null));
            flash.addFlashAttribute("mensaje", "Regla creada en modo simulación: registrará qué haría sin mover a nadie");
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        }
        return "redirect:" + RUTA + "?tab=reglas";
    }

    @PostMapping(RUTA + "/reglas/{id}/probar")
    String probar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, RedirectAttributes flash) {
        flash.addFlashAttribute("mensaje", reglas.probar(local(sesion, peticion), id).haria());
        return "redirect:" + RUTA + "?tab=reglas";
    }

    @PostMapping(RUTA + "/reglas/{id}/modo")
    String modo(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam String modo, HttpServletRequest peticion, RedirectAttributes flash) {
        return editar(sesion, id, null, modo, peticion, flash, "ACTIVA".equals(modo) ? "Regla activada: ejecutará sus acciones" : "Regla en simulación");
    }

    @PostMapping(RUTA + "/reglas/{id}/encendido")
    String encendido(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam boolean activa, HttpServletRequest peticion,
                     RedirectAttributes flash) {
        return editar(sesion, id, activa, null, peticion, flash, activa ? "Regla encendida" : "Regla apagada");
    }

    private String editar(Sesion sesion, int id, Boolean activa, String modo, HttpServletRequest peticion, RedirectAttributes flash, String ok) {
        try {
            reglas.editar(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion), id, null, activa, modo);
            flash.addFlashAttribute("mensaje", ok);
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        }
        return "redirect:" + RUTA + "?tab=reglas";
    }

    @PostMapping(RUTA + "/reglas/{id}/eliminar")
    String eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, RedirectAttributes flash) {
        evaluador.eliminar(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion), id);
        flash.addFlashAttribute("mensaje", "Regla eliminada");
        return "redirect:" + RUTA + "?tab=reglas";
    }

    @PostMapping(RUTA + "/ejecuciones/{id}/confirmar")
    String confirmar(@AuthenticationPrincipal Sesion sesion, @PathVariable long id, @RequestParam boolean aprobar, HttpServletRequest peticion,
                     RedirectAttributes flash) {
        try {
            var r = evaluador.resolverConfirmacion(Auditoria.Actor.de(sesion, peticion), local(sesion, peticion), id, aprobar);
            flash.addFlashAttribute("mensaje", r.ejecutada() ? "Acción ejecutada: " + r.detalle() : "Acción rechazada");
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        }
        return "redirect:" + RUTA + "?tab=historial";
    }

    @GetMapping(RUTA + "/historial.csv")
    ResponseEntity<byte[]> csv(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        List<EvaluadorBalanceo.VistaEjecucion> filas = evaluador.ejecuciones(local(sesion, peticion), null, null, null).items();
        StringBuilder sb = new StringBuilder("fecha,regla,fase,resultado,detalle\n");
        for (var e : filas) {
            sb.append(e.ts()).append(',').append(csv(e.regla())).append(',').append(e.fase()).append(',').append(e.resultado()).append(',')
                    .append(csv(e.textoDetalle())).append('\n');
        }
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"balanceo.csv\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8)).body(sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String csv(String v) {
        return v == null ? "" : "\"" + v.replace("\"", "\"\"") + "\"";
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modulos.exigir(localId, Modulo.M6);
        return localId;
    }
}
