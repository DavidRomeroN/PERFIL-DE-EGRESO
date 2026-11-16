package pe.turnoya.citas.administracion;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.citas.checkin.CheckinCitas;
import pe.turnoya.citas.dominio.RepositorioCitas.ConfigCitas;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloAdmin;
import pe.turnoya.plataforma.SoloPersonal;

/** {@code /api/v1/citas/**} (M3): agenda, próximas, PIN, acciones, configuración y bloqueos. Mismo contrato que el sistema anterior. */
@RestController
@RequestMapping("/api/v1/citas")
class CitasApi {

    private final GestionCitas gestion;
    private final CheckinCitas checkin;
    private final LocalDeTrabajo localDeTrabajo;
    private final ModulosLocal modulos;

    CitasApi(GestionCitas gestion, CheckinCitas checkin, LocalDeTrabajo localDeTrabajo, ModulosLocal modulos) {
        this.gestion = gestion;
        this.checkin = checkin;
        this.localDeTrabajo = localDeTrabajo;
        this.modulos = modulos;
    }

    @GetMapping
    @SoloPersonal
    RespuestaApi<GestionCitas.Agenda> agenda(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) String fecha,
                                            @RequestParam(required = false) Integer colaId, HttpServletRequest peticion) {
        int localId = local(sesion, peticion);
        LocalDate f = fecha == null || fecha.isBlank() ? gestion.hoy(localId) : fechaValida(fecha);
        return RespuestaApi.ok(gestion.agenda(localId, f, colaId));
    }

    @GetMapping("/proximas")
    @SoloPersonal
    RespuestaApi<List<GestionCitas.CitaDelDia>> proximas(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(gestion.proximas(local(sesion, peticion), 60));
    }

    @GetMapping("/pin")
    @SoloPersonal
    RespuestaApi<CheckinCitas.Pin> pin(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(checkin.pinActual(local(sesion, peticion)));
    }

    @PatchMapping("/{id}")
    @SoloAdmin
    RespuestaApi<Map<String, Object>> accion(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestBody AccionJson b,
                                             HttpServletRequest peticion) {
        return RespuestaApi.ok(gestion.accion(local(sesion, peticion), id, accion(b == null ? null : b.accion()), b == null ? null : b.slotId(),
                "usuario:" + sesion.sub()));
    }

    static GestionCitas.Accion accion(String valor) {
        try {
            return GestionCitas.Accion.valueOf(valor == null ? "" : valor);
        } catch (IllegalArgumentException e) {
            throw new ErrorNegocio("VALIDACION", "Acción inválida", 422);
        }
    }

    @GetMapping("/config")
    @SoloAdmin
    RespuestaApi<List<GestionCitas.ConfigDeCola>> config(@AuthenticationPrincipal Sesion sesion, @RequestParam(required = false) Integer colaId,
                                                        HttpServletRequest peticion) {
        return RespuestaApi.ok(gestion.configuraciones(local(sesion, peticion), colaId));
    }

    @PutMapping("/config")
    @SoloAdmin
    RespuestaApi<ConfigCitas> guardar(@AuthenticationPrincipal Sesion sesion, @RequestBody ConfigJson b, HttpServletRequest peticion) {
        if (b == null || b.colaId() == null || b.activo() == null || b.duracionSlotMin() == null || b.cuotaCitasPct() == null
                || b.anticipacionMinMin() == null || b.anticipacionMaxDias() == null || b.checkinAntesMin() == null || b.checkinDespuesMin() == null
                || b.graciaNoShowMin() == null || b.maxNoShow() == null || b.bloqueoDias() == null || b.pesoCita() == null) {
            throw new ErrorNegocio("VALIDACION", "Faltan campos de la configuración", 422);
        }
        var cfg = new ConfigCitas(b.activo(), b.duracionSlotMin(), b.cuotaCitasPct(), b.capacidadFija(), b.anticipacionMinMin(), b.anticipacionMaxDias(),
                b.checkinAntesMin(), b.checkinDespuesMin(), b.graciaNoShowMin(), b.maxNoShow(), b.bloqueoDias(), b.pesoCita(), null);
        return RespuestaApi.ok(gestion.guardarConfig(local(sesion, peticion), b.colaId(), cfg, Auditoria.Actor.de(sesion, peticion)));
    }

    @GetMapping("/bloqueos")
    @SoloAdmin
    RespuestaApi<GestionCitas.Bloqueos> bloqueos(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        return RespuestaApi.ok(gestion.bloqueos(local(sesion, peticion)));
    }

    @PostMapping("/bloqueos")
    @SoloAdmin
    ResponseEntity<RespuestaApi<Map<String, Integer>>> crearBloqueo(@AuthenticationPrincipal Sesion sesion, @RequestBody BloqueoJson b,
                                                                     HttpServletRequest peticion) {
        if (b == null || b.inicio() == null || b.fin() == null) {
            throw new ErrorNegocio("VALIDACION", "Indica el inicio y el fin", 422);
        }
        Instant inicio;
        Instant fin;
        try {
            inicio = Instant.parse(b.inicio());
            fin = Instant.parse(b.fin());
        } catch (RuntimeException e) {
            throw new ErrorNegocio("VALIDACION", "Fechas inválidas (ISO 8601)", 422);
        }
        int id = gestion.crearBloqueo(local(sesion, peticion), b.colaId(), inicio, fin, b.motivo());
        return RespuestaApi.creado(Map.of("id", id));
    }

    @DeleteMapping("/bloqueos/{id}")
    @SoloAdmin
    RespuestaApi<Map<String, Boolean>> eliminarBloqueo(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion) {
        gestion.eliminarBloqueo(local(sesion, peticion), id);
        return RespuestaApi.ok(Map.of("eliminado", true));
    }

    @DeleteMapping("/bloqueos-cliente/{id}")
    @SoloAdmin
    RespuestaApi<Map<String, Boolean>> liberar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion) {
        gestion.liberarCliente(local(sesion, peticion), id, sesion.sub());
        return RespuestaApi.ok(Map.of("liberado", true));
    }

    static LocalDate fechaValida(String fecha) {
        try {
            return LocalDate.parse(fecha);
        } catch (RuntimeException e) {
            throw new ErrorNegocio("VALIDACION", "Fecha inválida (yyyy-mm-dd)", 422);
        }
    }

    private int local(Sesion sesion, HttpServletRequest peticion) {
        int localId = localDeTrabajo.resolver(sesion, peticion);
        modulos.exigir(localId, Modulo.M3);
        return localId;
    }

    record AccionJson(String accion, Integer slotId) {
    }

    record ConfigJson(Integer colaId, Boolean activo, Integer duracionSlotMin, Integer cuotaCitasPct, Integer capacidadFija, Integer anticipacionMinMin,
                      Integer anticipacionMaxDias, Integer checkinAntesMin, Integer checkinDespuesMin, Integer graciaNoShowMin, Integer maxNoShow,
                      Integer bloqueoDias, Integer pesoCita) {
    }

    record BloqueoJson(Integer colaId, String inicio, String fin, String motivo) {
    }
}
