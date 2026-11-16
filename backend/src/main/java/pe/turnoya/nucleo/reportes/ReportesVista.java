package pe.turnoya.nucleo.reportes;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
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
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;

/** Reportes de espera y atención (RF09): rango de fechas, gráficos por día, hora, cola y canal, y exportación CSV. */
@Controller
@SoloAdmin
class ReportesVista {

    private final ReportesTurnos reportes;
    private final LocalDeTrabajo localDeTrabajo;

    ReportesVista(ReportesTurnos reportes, LocalDeTrabajo localDeTrabajo) {
        this.reportes = reportes;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/admin/reportes")
    String pagina(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate desde,
                  @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate hasta,
                  HttpServletRequest peticion, Model modelo) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        LocalDate fin = hasta != null ? hasta : reportes.haceDias(localId, 0);
        LocalDate inicio = desde != null ? desde : fin.minusDays(13);
        modelo.addAttribute("seccion", "reportes");
        modelo.addAttribute("reporte", reportes.generar(localId, inicio, fin));
        return "admin/reportes";
    }

    @GetMapping(value = "/admin/reportes.csv")
    @ResponseBody
    ResponseEntity<byte[]> csv(@AuthenticationPrincipal Sesion sesion, @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate desde,
                               @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate hasta, HttpServletRequest peticion) {
        ReporteEspera r = reportes.generar(localDeTrabajo.resolver(sesion, peticion), desde, hasta);
        return descarga(r);
    }

    /** Mismas columnas que el CSV del sistema anterior, con BOM para que Excel lea las tildes. */
    static ResponseEntity<byte[]> descarga(ReporteEspera r) {
        StringBuilder csv = new StringBuilder("﻿fecha,codigo,cola,estado,canal,ventanilla,emitido,llamado,finalizado,espera_min,atencion_min");
        for (ReporteEspera.Detalle d : r.detalle()) {
            csv.append("\r\n").append(String.join(",", celda(d.fecha()), celda(d.codigo()), celda(d.cola()), celda(d.estado()), celda(d.canal()),
                    celda(d.ventanilla()), celda(d.emitidoAt()), celda(d.llamadoAt()), celda(d.finalizadoAt()), celda(d.esperaMin()),
                    celda(d.atencionMin())));
        }
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"turnoya_reporte_" + r.rango().desde() + "_" + r.rango().hasta() + ".csv\"")
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String celda(Object valor) {
        return "\"" + (valor == null ? "" : valor.toString().replace("\"", "\"\"")) + "\"";
    }
}
