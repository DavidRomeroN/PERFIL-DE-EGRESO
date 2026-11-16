package pe.turnoya.balanceo.transferencias;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.SoloPersonal;

/** {@code POST /api/v1/turnos/{id}/transferir} (personal) y {@code GET /api/v1/transferencias} (admin). */
@RestController
class TransferenciasApi {

    private final Transferencias transferencias;
    private final LocalDeTrabajo localDeTrabajo;

    TransferenciasApi(Transferencias transferencias, LocalDeTrabajo localDeTrabajo) {
        this.transferencias = transferencias;
        this.localDeTrabajo = localDeTrabajo;
    }

    /** Conserva hora de emisión y categoría (RF-M6-01/02). */
    @PostMapping("/api/v1/turnos/{id}/transferir")
    @SoloPersonal
    ResponseEntity<RespuestaApi<TurnoPublico>> transferir(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestBody Cuerpo b,
                                                         HttpServletRequest peticion) {
        if (b == null || b.aColaId() == null) {
            throw new ErrorNegocio("VALIDACION", "Indica la cola destino", 422);
        }
        return RespuestaApi.creado(transferencias.transferir(Auditoria.Actor.de(sesion, peticion), localDeTrabajo.resolver(sesion, peticion), id,
                Transferencias.Solicitud.manual(b.aColaId(), b.aVentanillaId(), b.motivo(), b.detalle(), b.notificar())));
    }

    @GetMapping("/api/v1/transferencias")
    @SoloAdmin
    RespuestaApi<Transferencias.Historial> historial(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String desde,
                                                    @RequestParam(required = false) String hasta, @RequestParam(required = false) Integer cursor,
                                                    HttpServletRequest peticion) {
        return RespuestaApi.ok(transferencias.historial(localDeTrabajo.resolver(sesion, peticion), instante(desde, false), instante(hasta, true), cursor));
    }

    /** Acepta un instante ISO o una fecha {@code AAAA-MM-DD} (inicio o fin del día UTC). */
    private static Instant instante(String texto, boolean finDelDia) {
        if (texto == null || texto.isBlank()) {
            return null;
        }
        try {
            if (texto.length() == 10) {
                LocalDate f = LocalDate.parse(texto);
                return (finDelDia ? f.plusDays(1) : f).atStartOfDay().toInstant(ZoneOffset.UTC);
            }
            return Instant.parse(texto);
        } catch (RuntimeException e) {
            throw new ErrorNegocio("VALIDACION", "Fecha inválida", 422);
        }
    }

    record Cuerpo(Integer aColaId, Integer aVentanillaId, String motivo, String detalle, Boolean notificar) {
    }
}
