package pe.turnoya.nucleo.pantalla;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.web.GeneradorQr;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.SnapshotLocal;
import pe.turnoya.nucleo.appmovil.PresenciaApp;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;

/**
 * Pantalla TV de la sala de espera (RF12): llamado en grande, una sola lista de últimos llamados, resumen por cola y
 * los QR para tomar turno. Con {@code ?colas=1,3} la pantalla es de una sala: solo muestra y anuncia esas colas.
 */
@Controller
class PantallaTvVista {

    private static final int FILAS = 6;

    private final ConsultaTurnos consulta;
    private final CatalogoLocales locales;
    private final PropiedadesTurnoYa propiedades;
    private final GeneradorQr qr;
    private final PresenciaApp presencia;

    PantallaTvVista(ConsultaTurnos consulta, CatalogoLocales locales, PropiedadesTurnoYa propiedades, GeneradorQr qr, PresenciaApp presencia) {
        this.presencia = presencia;
        this.consulta = consulta;
        this.locales = locales;
        this.propiedades = propiedades;
        this.qr = qr;
    }

    /** Fila de la lista de la TV: un turno llamado y a qué ventanilla fue. */
    record Fila(String codigo, String ventanilla, Instant hora, boolean enAtencion) {
    }

    @GetMapping("/l/{slug}/tv")
    String pantalla(@PathVariable String slug, @RequestParam(required = false) String colas, Model modelo) {
        cargar(slug, colas, modelo);
        return "tv/pantalla";
    }

    @GetMapping("/l/{slug}/tv/contenido")
    String contenido(@PathVariable String slug, @RequestParam(required = false) String colas, Model modelo) {
        cargar(slug, colas, modelo);
        return "tv/pantalla :: contenido";
    }

    private void cargar(String slug, String colas, Model modelo) {
        Local local = locales.activoPorSlug(slug);
        Set<Integer> pedidas = ids(colas);
        SnapshotLocal snap = consulta.snapshot(local, false, pedidas);
        // Es una sala solo si el filtro dejó fuera alguna cola (un enlace viejo con colas borradas muestra todo)
        boolean sala = !pedidas.isEmpty() && snap.colas().stream().allMatch(c -> pedidas.contains(c.id()));
        modelo.addAttribute("snap", snap);
        modelo.addAttribute("sala", sala);
        modelo.addAttribute("colasParam", sala ? snap.colas().stream().map(c -> String.valueOf(c.id())).collect(Collectors.joining(",")) : null);
        modelo.addAttribute("nombreSala", sala ? snap.colas().stream().map(SnapshotLocal.ColaInfo::nombre).collect(Collectors.joining(" · ")) : null);
        modelo.addAttribute("filas", filas(snap));
        // QR de la app: lleva el slug y la marca de presencia (cambia cada 5 min: una foto vieja no sirve para tomar turno).
        // La app lo lee directo; con la cámara abre una página que ofrece la app o la web
        String urlApp = propiedades.urlPublica() + "/l/" + slug + "/app";
        modelo.addAttribute("urlApp", urlApp);
        modelo.addAttribute("qrApp", qr.svg(urlApp + "?p=" + presencia.vigente(local.id()), 128));
    }

    /**
     * Una sola lista para leer de lejos: primero los turnos que siguen en atención y luego los ya atendidos más
     * recientes. El último llamado no entra: ya está en grande.
     */
    private static List<Fila> filas(SnapshotLocal snap) {
        Integer destacado = snap.ultimosLlamados().isEmpty() ? null : snap.ultimosLlamados().getFirst().id();
        List<Fila> filas = new ArrayList<>();
        Set<Integer> vistos = new LinkedHashSet<>();
        snap.colas().stream().flatMap(c -> c.llamados().stream())
                .sorted(Comparator.comparing(SnapshotLocal.Llamado::llamadoAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .forEach(l -> {
                    vistos.add(l.id());
                    if (!Integer.valueOf(l.id()).equals(destacado)) {
                        filas.add(new Fila(l.codigo(), l.ventanilla(), l.llamadoAt(), true));
                    }
                });
        for (SnapshotLocal.UltimoLlamado u : snap.ultimosLlamados()) {
            if (!vistos.contains(u.id()) && !Integer.valueOf(u.id()).equals(destacado) && u.estado() != EstadoTurno.LLAMADO) {
                filas.add(new Fila(u.codigo(), u.ventanilla(), u.llamadoAt(), false));
            }
        }
        return filas.size() > FILAS ? filas.subList(0, FILAS) : filas;
    }

    /** {@code "1,3"} → {1, 3}; ignora lo que no sea un número. */
    static Set<Integer> ids(String colas) {
        Set<Integer> ids = new LinkedHashSet<>();
        if (colas != null) {
            for (String parte : colas.split(",")) {
                try {
                    ids.add(Integer.parseInt(parte.trim()));
                } catch (NumberFormatException ignorado) {
                    // un id mal escrito no rompe la pantalla
                }
            }
        }
        return ids;
    }
}
