package pe.turnoya.prioridades.configuracion;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.prioridades.dominio.ReglasPrioridad.Config;

/**
 * {@code /admin/modulos/prioridades}: parámetros con vista previa en vivo (htmx), categorías con su peso, documento,
 * visibilidad y estado.
 */
@Controller
@SoloAdmin
class AdminPrioridadesVista {

    private static final String RUTA = "/admin/modulos/prioridades";

    /** Código → categoría de la cola de ejemplo (para rotular el orden FIFO). */
    private static final Map<String, String> EJEMPLO = GestionPrioridades.EJEMPLO.stream()
            .collect(java.util.stream.Collectors.toMap(t -> t.codigo(), t -> t.categoria(), (a, b) -> a, java.util.LinkedHashMap::new));

    private final GestionPrioridades gestion;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;

    AdminPrioridadesVista(GestionPrioridades gestion, LocalDeTrabajo localDeTrabajo, ModulosLocal modulos) {
        this.gestion = gestion;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
    }

    @GetMapping(RUTA)
    String pagina(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion, Model modelo) {
        int localId = local(sesion, peticion);
        var datos = gestion.listar(localId);
        modelo.addAttribute("seccion", "M1");
        modelo.addAttribute("datos", datos);
        modelo.addAttribute("documentos", GestionPrioridades.DOCUMENTOS);
        previa(localId, datos, datos.config(), modelo);
        return "modulos/prioridades";
    }

    /** Vista previa con los valores del formulario, sin guardar (se llama al mover los controles). */
    @PostMapping(RUTA + "/vista-previa")
    String vistaPrevia(@AuthenticationPrincipal Sesion sesion, @RequestParam(defaultValue = "0") double alfa, @RequestParam(defaultValue = "0") int tope,
                       @RequestParam(defaultValue = "false") boolean aging, HttpServletRequest peticion,
                       Model modelo) {
        int localId = local(sesion, peticion);
        previa(localId, gestion.listar(localId), new Config(alfa, tope, aging), modelo);
        return "modulos/prioridades :: vista-previa";
    }

    @PostMapping(RUTA + "/config")
    ResponseEntity<Void> guardarConfig(@AuthenticationPrincipal Sesion sesion, @RequestParam double alfa, @RequestParam int tope,
                                       @RequestParam(defaultValue = "false") boolean aging, HttpServletRequest peticion, HttpServletResponse respuesta) {
        var r = gestion.guardarConfig(local(sesion, peticion), new Config(alfa, tope, aging), Auditoria.Actor.de(sesion, peticion));
        return listo(peticion, respuesta, "Parámetros guardados · " + r.get("recalculados") + " turnos reordenados");
    }

    @PostMapping(RUTA + "/categorias")
    String crear(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String codigo, @RequestParam String nombre, @RequestParam int pesoBase,
                 @RequestParam(defaultValue = "NINGUNO") String documento, @RequestParam(defaultValue = "false") boolean visibleCliente,
                 HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        int localId = local(sesion, peticion);
        // El código es interno: si no viene, sale del nombre ("Niño pequeño" → NINO_PEQUENO)
        String cod = codigo == null || codigo.isBlank() ? codigoDe(nombre) : codigo;
        var c = gestion.crear(localId, new GestionPrioridades.NuevaCategoria(cod, nombre, null, pesoBase, false, documento, null, visibleCliente, true, null),
                Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Categoría " + c.nombre() + " creada");
        return lista(localId, peticion, modelo);
    }

    /** Cambio de un solo campo desde la tabla (peso al salir del campo, interruptores al cambiar). */
    @PostMapping(RUTA + "/categorias/{id}")
    String editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestParam(required = false) Integer pesoBase,
                  @RequestParam(required = false) String visibleCliente, @RequestParam(required = false) String activa,
                  HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        int localId = local(sesion, peticion);
        var c = gestion.editar(localId, id, new GestionPrioridades.CambioCategoria(null, null, pesoBase, null, null, null,
                visibleCliente == null ? null : "true".equals(visibleCliente), activa == null ? null : "true".equals(activa), null),
                Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, "Categoría " + c.nombre() + " actualizada");
        return lista(localId, peticion, modelo);
    }

    @PostMapping(RUTA + "/categorias/{id}/eliminar")
    String eliminar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion, HttpServletResponse respuesta, Model modelo) {
        int localId = local(sesion, peticion);
        var r = gestion.eliminar(localId, id, Auditoria.Actor.de(sesion, peticion));
        Htmx.aviso(respuesta, Htmx.Tipo.EXITO, Boolean.TRUE.equals(r.get("borradoLogico")) ? "Categoría desactivada (tiene turnos)" : "Categoría eliminada");
        return lista(localId, peticion, modelo);
    }

    /** Datos de la vista previa: cola de ejemplo, nombres de las categorías y la regla explicada con un ejemplo. */
    private void previa(int localId, GestionPrioridades.Prioridades datos, Config cfg, Model modelo) {
        Map<String, String> nombres = new java.util.HashMap<>();
        datos.categorias().forEach(c -> nombres.put(c.codigo(), c.nombre()));
        Map<String, Double> esperas = GestionPrioridades.EJEMPLO.stream()
                .collect(java.util.stream.Collectors.toMap(t -> t.codigo(), t -> t.esperaMin()));
        modelo.addAttribute("ejemplo", EJEMPLO);
        modelo.addAttribute("esperas", esperas);
        modelo.addAttribute("nombresCategoria", nombres);
        modelo.addAttribute("vista", gestion.simular(localId, cfg, null, null));
        modelo.addAttribute("explicacion", explicar(datos, cfg));
    }

    /** La regla en palabras: "alguien sin preferencia que lleva 40 min esperando pasa delante de…". */
    static String explicar(GestionPrioridades.Prioridades datos, Config cfg) {
        var preferentes = datos.categorias().stream().filter(c -> c.activa() && !c.absoluta() && c.pesoBase() > 0 && !"CITA".equals(c.codigo())).toList();
        var ejemplo = preferentes.stream().filter(c -> "GESTANTE".equals(c.codigo())).findFirst()
                .or(() -> preferentes.stream().max(java.util.Comparator.comparingInt(c -> c.pesoBase())));
        StringBuilder texto = new StringBuilder();
        if (ejemplo.isEmpty()) {
            texto.append("No hay categorías con preferencia activas: se atiende por orden de llegada.");
            return texto.toString();
        }
        String nombre = ejemplo.get().nombre();
        if (cfg.aging() && cfg.alfa() > 0) {
            long minutos = Math.round(ejemplo.get().pesoBase() / cfg.alfa());
            texto.append("Alguien sin preferencia que lleva ").append(minutos).append(" min esperando pasa delante de una persona de «")
                    .append(nombre).append("» que recién llega.");
        } else {
            texto.append("El tiempo de espera no cuenta: quien tiene preferencia siempre pasa antes que quien no la tiene.");
        }
        if (cfg.tope() > 0) {
            texto.append(" Después de ").append(cfg.tope()).append(cfg.tope() == 1 ? " persona" : " personas")
                    .append(" con preferencia seguidas, se atiende a alguien sin preferencia.");
        }
        return texto.toString();
    }

    static String codigoDe(String nombre) {
        String sinTildes = java.text.Normalizer.normalize(nombre == null ? "" : nombre, java.text.Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        String cod = sinTildes.toUpperCase(java.util.Locale.ROOT).replaceAll("[^A-Z0-9]+", "_").replaceAll("^_+|_+$", "");
        if (cod.length() > 16) {
            cod = cod.substring(0, 16).replaceAll("_+$", "");
        }
        return cod.length() < 2 ? "CATEGORIA" : cod;
    }

    private String lista(int localId, HttpServletRequest peticion, Model modelo) {
        if (!Htmx.esPeticion(peticion)) {
            return "redirect:" + RUTA;
        }
        modelo.addAttribute("datos", gestion.listar(localId));
        modelo.addAttribute("documentos", GestionPrioridades.DOCUMENTOS);
        return "modulos/prioridades :: categorias";
    }

    private static ResponseEntity<Void> listo(HttpServletRequest peticion, HttpServletResponse respuesta, String mensaje) {
        if (Htmx.esPeticion(peticion)) {
            Htmx.aviso(respuesta, Htmx.Tipo.EXITO, mensaje);
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.status(HttpStatus.SEE_OTHER).header(HttpHeaders.LOCATION, RUTA).build();
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modulos.exigir(localId, Modulo.M1);
        return localId;
    }
}
