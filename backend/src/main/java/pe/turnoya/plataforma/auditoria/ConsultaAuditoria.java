package pe.turnoya.plataforma.auditoria;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.dominio.RepositorioAuditoria;
import pe.turnoya.plataforma.dominio.RepositorioAuditoria.FilaAuditoria;
import pe.turnoya.plataforma.dominio.RepositorioAuditoria.FiltroAuditoria;

/** Consulta del registro de auditoría: 50 eventos por página y hasta 5000 en el CSV, como el sistema anterior. */
@Service
class ConsultaAuditoria {

    static final int POR_PAGINA = 50;
    private static final int MAX_CSV = 5000;

    private final RepositorioAuditoria auditoria;
    private final CatalogoLocales locales;

    ConsultaAuditoria(RepositorioAuditoria auditoria, CatalogoLocales locales) {
        this.auditoria = auditoria;
        this.locales = locales;
    }

    Pagina pagina(int localId, Filtros f) {
        List<FilaAuditoria> filas = auditoria.consultar(localId, filtro(localId, f), POR_PAGINA);
        Long siguiente = filas.size() == POR_PAGINA ? filas.getLast().id() : null;
        return new Pagina(filas, siguiente);
    }

    ResponseEntity<byte[]> csv(int localId, Filtros f) {
        Filtros sinCursor = new Filtros(f.desde(), f.hasta(), f.accion(), f.entidad(), f.texto(), f.requestId(), null);
        StringBuilder csv = new StringBuilder("﻿id,fecha,usuario,accion,entidad,entidad_id,descripcion,ip,request_id,datos");
        for (FilaAuditoria a : auditoria.consultar(localId, filtro(localId, sinCursor), MAX_CSV)) {
            csv.append("\r\n").append(String.join(",", celda(a.id()), celda(a.createdAt()), celda(a.usuarioEmail() == null ? "sistema" : a.usuarioEmail()),
                    celda(a.accion()), celda(a.entidad()), celda(a.entidadId()), celda(a.accionHumana()), celda(a.ip()), celda(a.requestId()),
                    celda(a.datosJson())));
        }
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"auditoria.csv\"")
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    private FiltroAuditoria filtro(int localId, Filtros f) {
        ZoneId zona = locales.exigir(localId).zonaHoraria();
        return new FiltroAuditoria(
                f.desde() == null ? null : f.desde().atStartOfDay(zona).toInstant(),
                f.hasta() == null ? null : f.hasta().plusDays(1).atStartOfDay(zona).toInstant(),
                vacioANulo(f.accion()), vacioANulo(f.entidad()), vacioANulo(f.texto()), vacioANulo(f.requestId()), f.cursor());
    }

    private static String vacioANulo(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String celda(Object valor) {
        return "\"" + (valor == null ? "" : valor.toString().replace("\"", "\"\"")) + "\"";
    }

    record Filtros(LocalDate desde, LocalDate hasta, String accion, String entidad, String texto, String requestId, Long cursor) {
    }

    record Pagina(List<FilaAuditoria> items, Long cursor) {
    }
}
