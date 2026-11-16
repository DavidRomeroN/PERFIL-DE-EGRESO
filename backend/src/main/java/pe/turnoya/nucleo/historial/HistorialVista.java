package pe.turnoya.nucleo.historial;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.Optional;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.compartido.web.Formatos;
import pe.turnoya.compartido.web.Htmx;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.dominio.RepositorioTurnos.FilaHistorial;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloPersonal;

/**
 * N02 · {@code /panel/historial}: turnos del día con filtros (fecha, estado, ventanilla) e indicadores. Por defecto
 * muestra la ventanilla que el dispositivo recuerda del panel (cookie {@code turnoya_ventanilla}).
 */
@Controller
@SoloPersonal
class HistorialVista {

    private static final String COOKIE_VENTANILLA = "turnoya_ventanilla";

    private final HistorialTurnos historial;
    private final ConsultaTurnos consulta;
    private final LocalDeTrabajo localDeTrabajo;
    private final Formatos formatos;
    private final Clock reloj;

    HistorialVista(HistorialTurnos historial, ConsultaTurnos consulta, LocalDeTrabajo localDeTrabajo, Formatos formatos, Clock reloj) {
        this.historial = historial;
        this.consulta = consulta;
        this.localDeTrabajo = localDeTrabajo;
        this.formatos = formatos;
        this.reloj = reloj;
    }

    @GetMapping("/panel/historial")
    String pagina(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fecha,
                  @RequestParam(required = false) EstadoTurno estado, @RequestParam(required = false) String ventanilla,
                  @RequestParam(required = false) Integer cursor, HttpServletRequest peticion, Model modelo) {
        Local local = localDeTrabajo.local(sesion, peticion);
        // Sin parámetro: la ventanilla recordada; "todas" (o vacío) quita el filtro
        Integer ventanillaId = ventanilla == null ? recordada(peticion, local.slug()).orElse(null)
                : ventanilla.matches("\\d{1,9}") ? Integer.valueOf(ventanilla) : null;
        var pagina = historial.consultar(local.id(), fecha, ventanillaId, estado, cursor);
        modelo.addAttribute("local", local);
        modelo.addAttribute("ventanillas", consulta.snapshot(local, false).ventanillas());
        modelo.addAttribute("pagina", pagina);
        modelo.addAttribute("fecha", fecha != null ? fecha : Fechas.fechaLocal(local.zonaHoraria(), reloj.instant()));
        modelo.addAttribute("estado", estado);
        modelo.addAttribute("ventanillaId", ventanillaId);
        modelo.addAttribute("estados", EstadoTurno.values());
        return Htmx.esPeticion(peticion) ? "panel/historial :: resultados" : "panel/historial";
    }

    @GetMapping("/panel/historial.csv")
    @ResponseBody
    ResponseEntity<byte[]> csv(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fecha,
                               @RequestParam(required = false) EstadoTurno estado, @RequestParam(required = false) String ventanilla, HttpServletRequest peticion) {
        Local local = localDeTrabajo.local(sesion, peticion);
        Integer ventanillaId = ventanilla != null && ventanilla.matches("\\d{1,9}") ? Integer.valueOf(ventanilla) : null;
        StringBuilder csv = new StringBuilder("﻿codigo,cola,estado,canal,emitido,llamado,finalizado,ventanilla");
        Integer cursor = null;
        LocalDate dia = fecha != null ? fecha : Fechas.fechaLocal(local.zonaHoraria(), reloj.instant());
        do {
            var pagina = historial.consultar(local.id(), dia, ventanillaId, estado, cursor);
            for (FilaHistorial t : pagina.items()) {
                csv.append("\r\n").append(String.join(",", celda(t.codigo()), celda(t.cola()), celda(t.estado().name()), celda(t.canal().name()),
                        celda(t.emitidoAt() == null ? "" : formatos.hora(t.emitidoAt())), celda(t.llamadoAt() == null ? "" : formatos.hora(t.llamadoAt())),
                        celda(t.finalizadoAt() == null ? "" : formatos.hora(t.finalizadoAt())), celda(t.ventanilla())));
            }
            cursor = pagina.cursor();
        } while (cursor != null);
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"historial-" + dia + ".csv\"")
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String celda(Object valor) {
        return "\"" + (valor == null ? "" : valor.toString().replace("\"", "\"\"")) + "\"";
    }

    private static Optional<Integer> recordada(HttpServletRequest peticion, String slug) {
        if (peticion.getCookies() == null) {
            return Optional.empty();
        }
        return Arrays.stream(peticion.getCookies())
                .filter(c -> COOKIE_VENTANILLA.equals(c.getName()))
                .map(Cookie::getValue)
                .filter(v -> v.startsWith(slug + ":"))
                .map(v -> v.substring(slug.length() + 1))
                .filter(v -> v.matches("\\d{1,9}"))
                .map(Integer::valueOf)
                .findFirst();
    }
}
