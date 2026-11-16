package pe.turnoya.kiosco.recepcion;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.SnapshotLocal;
import pe.turnoya.nucleo.TomaDeTurnos;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloKiosco;
import pe.turnoya.transferencias.Transferencias;

/**
 * La recepción desde la app móvil (rol kiosco): lo mismo que {@code /panel-kiosco} en la web. Emite tickets para
 * cualquier cola del local, ve a todos los que esperan y, si el plan lo permite, pasa a un cliente a otra cola.
 */
@RestController
@SoloKiosco
class KioscoMovilApi {

    private final ConsultaTurnos consulta;
    private final TomaDeTurnos toma;
    private final Transferencias transferencias;
    private final CatalogoLocales locales;
    private final LocalDeTrabajo localDeTrabajo;

    KioscoMovilApi(ConsultaTurnos consulta, TomaDeTurnos toma, Transferencias transferencias, CatalogoLocales locales,
                   LocalDeTrabajo localDeTrabajo) {
        this.consulta = consulta;
        this.toma = toma;
        this.transferencias = transferencias;
        this.locales = locales;
        this.localDeTrabajo = localDeTrabajo;
    }

    @GetMapping("/api/v1/movil/kiosco")
    ResponseEntity<RespuestaApi<PanelKiosco>> panel(@AuthenticationPrincipal Sesion sesion, HttpServletRequest peticion) {
        Local local = local(sesion, peticion);
        SnapshotLocal snap = consulta.snapshot(local, true);
        List<ColaKiosco> colas = snap.colas().stream()
                .map(c -> new ColaKiosco(c.id(), c.nombre(), c.prefijo(), c.enEspera(), c.tiempoEstimadoSeg()))
                .toList();
        List<EnEsperaKiosco> espera = snap.colas().stream()
                .flatMap(c -> c.espera().stream().map(t -> new EnEsperaKiosco(t.id(), t.codigo() != null ? t.codigo() : t.codigoProvisional(),
                        t.nombre(), t.canal().name(), t.emitidoAt(), c.id(), c.nombre(), c.prefijo())))
                .sorted(Comparator.comparing(EnEsperaKiosco::emitidoAt))
                .toList();
        boolean puedeTransferir = transferencias.disponible(local.id()) && colas.size() > 1;
        var datos = new PanelKiosco(sesion.nombre(), local.nombreComercial(), local.slug(),
                snap.local().plan() != null && snap.local().plan().whatsappHabilitado(), colas, espera, puedeTransferir);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(RespuestaApi.ok(datos));
    }

    /** Ticket para cualquier cola del local; con celular y consentimiento, el cliente recibe su número por WhatsApp. */
    @PostMapping("/api/v1/movil/kiosco/ticket")
    ResponseEntity<RespuestaApi<TurnoPublico>> ticket(@Valid @RequestBody PedidoTicket pedido, @AuthenticationPrincipal Sesion sesion,
                                                      HttpServletRequest peticion) {
        Local local = local(sesion, peticion);
        String nombre = pedido.nombre() == null || pedido.nombre().isBlank() ? null : pedido.nombre().trim();
        return RespuestaApi.creado(toma.ticketDeRecepcion(local.id(), pedido.colaId(), nombre, null, pedido.telefono(),
                Boolean.TRUE.equals(pedido.consentimiento())));
    }

    /** Pasa a un cliente que espera a otra cola: conserva su hora de llegada y su prioridad. */
    @PostMapping("/api/v1/movil/kiosco/transferir")
    RespuestaApi<TurnoPublico> transferir(@Valid @RequestBody PedidoTransferencia pedido, @AuthenticationPrincipal Sesion sesion,
                                          HttpServletRequest peticion) {
        Local local = local(sesion, peticion);
        return RespuestaApi.ok(transferencias.transferir(Auditoria.Actor.de(sesion, peticion), local.id(), pedido.turnoId(),
                Transferencias.Solicitud.manual(pedido.aColaId(), null, "ERROR_DE_COLA", null, true)));
    }

    private Local local(Sesion sesion, HttpServletRequest peticion) {
        return locales.exigir(localDeTrabajo.resolver(sesion, peticion));
    }

    record PanelKiosco(String usuario, String local, String slug, boolean whatsapp, List<ColaKiosco> colas, List<EnEsperaKiosco> espera,
                       boolean puedeTransferir) {
    }

    record ColaKiosco(int id, String nombre, String prefijo, int enEspera, int tiempoEstimadoSeg) {
    }

    record EnEsperaKiosco(int id, String codigo, String nombre, String canal, Instant emitidoAt, int colaId, String cola, String prefijo) {
    }

    record PedidoTicket(@NotNull @Positive Integer colaId, @Size(max = 60) String nombre, @Size(max = 20) String telefono,
                        Boolean consentimiento) {
    }

    record PedidoTransferencia(@NotNull @Positive Integer turnoId, @NotNull @Positive Integer aColaId) {
    }
}
