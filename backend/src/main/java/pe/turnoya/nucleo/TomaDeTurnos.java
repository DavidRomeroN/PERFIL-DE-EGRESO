package pe.turnoya.nucleo;

import java.time.Instant;
import java.util.List;
import pe.turnoya.nucleo.puertos.PoliticaPrioridad;
import org.springframework.stereotype.Service;
import pe.turnoya.nucleo.emision.EmisionTurnos;
import pe.turnoya.nucleo.emision.InformacionLocal;
import pe.turnoya.nucleo.emision.SolicitudEmision;
import pe.turnoya.nucleo.seguimiento.CancelacionTurnos;

/**
 * Puerto de entrada del núcleo para los otros canales (el bot de WhatsApp, el check-in de citas, el kiosco): ver las
 * colas abiertas de un local, tomar turno en nombre del cliente y cancelarlo. Usa los mismos casos de uso que la web y la app, así que el
 * turno entra en la misma cola y respeta las mismas reglas (horario, límite del plan, un turno activo por celular).
 */
@Service
public class TomaDeTurnos {

    private final InformacionLocal informacion;
    private final EmisionTurnos emision;
    private final CancelacionTurnos cancelacion;

    TomaDeTurnos(InformacionLocal informacion, EmisionTurnos emision, CancelacionTurnos cancelacion) {
        this.informacion = informacion;
        this.emision = emision;
        this.cancelacion = cancelacion;
    }

    /** Colas activas del local con su espera actual. Lanza {@code ErrorNegocio} si el local no existe. */
    public LocalAbierto local(String slug) {
        InformacionLocal.LocalParaCliente l = informacion.porSlug(slug);
        List<ColaAbierta> colas = l.colas().stream()
                .map(c -> new ColaAbierta(c.id(), c.prefijo(), c.nombre(), c.enEspera(), c.tiempoEstimadoSeg(), c.descripcion()))
                .toList();
        return new LocalAbierto(l.id(), l.slug(), l.nombreComercial(), l.abierto(), l.mensajeCerrado(), colas, l.categorias());
    }

    /** Emite un turno con canal WHATSAPP. Sin consentimiento no se guarda el celular (Ley 29733). */
    public TurnoPublico porWhatsApp(int colaId, String nombre, String telefonoE164, boolean consentimiento) {
        return emision.emitir(SolicitudEmision.porWhatsApp(colaId, nombre, consentimiento ? telefonoE164 : null, consentimiento));
    }

    /**
     * M3 · Check-in de una cita: el turno entra a la cola con canal CITA y su hora de emisión (llegar temprano no
     * adelanta a nadie). {@code conPrioridadCita} falso si llegó tarde: entra como turno general. Sin validar horario.
     */
    public TurnoPublico porCita(int colaId, int clienteId, boolean conPrioridadCita, Instant emitidoAt, int citaId) {
        return emision.emitir(new SolicitudEmision(colaId, CanalTurno.CITA, null, null, false, conPrioridadCita ? "CITA" : null, OrigenCategoria.CITA,
                clienteId, emitidoAt, citaId, null, null, null, true, false));
    }

    /** Cliente (nuevo o existente por celular) para una reserva. {@code null} si no dio nombre ni celular. */
    public Integer cliente(String nombre, String telefono, boolean consentimiento) {
        return emision.resolverCliente(nombre, telefono, consentimiento);
    }

    /**
     * M5 · Ticket del kiosco (en línea o sincronizado después de estar sin conexión). {@code emitidoAt} es la hora
     * corregida del evento; {@code omitirHorario} si el ticket se emitió antes (offline) dentro del horario.
     * {@code porPersonal}: lo emite el admin al resolver un evento en revisión (la categoría queda verificada).
     */
    public TurnoPublico porKiosco(int colaId, String nombre, String telefono, boolean consentimiento, String categoria, Instant emitidoAt,
                                  int dispositivoId, String codigoProvisional, boolean omitirHorario, boolean porPersonal) {
        return emision.emitir(new SolicitudEmision(colaId, CanalTurno.KIOSCO, nombre, telefono, consentimiento, categoria,
                porPersonal ? OrigenCategoria.PERSONAL : OrigenCategoria.CLIENTE, null, emitidoAt, null, dispositivoId, codigoProvisional, null,
                omitirHorario, false));
    }

    /** M6 · Transfiere el turno a otra cola del local conservando su lugar. Corre en la transacción de quien llama. */
    public TurnoTransferido transferir(int localId, int turnoId, int aColaId) {
        var r = emision.transferir(localId, turnoId, aColaId);
        return new TurnoTransferido(r.origenId(), r.origenCodigo(), r.deColaId(), r.sucesorId(), r.sucesorCodigo(), r.sucesorToken(), r.aColaId(),
                r.colaDestino());
    }

    public TurnoPublico cancelar(String token) {
        return cancelacion.cancelar(token);
    }

    public record LocalAbierto(int id, String slug, String nombreComercial, boolean abierto, String mensajeCerrado, List<ColaAbierta> colas,
                               List<PoliticaPrioridad.CategoriaCliente> categorias) {
    }

    public record TurnoTransferido(int origenId, String origenCodigo, int deColaId, int sucesorId, String sucesorCodigo, String sucesorToken,
                                   int aColaId, String colaDestino) {
    }

    public record ColaAbierta(int id, String prefijo, String nombre, int enEspera, int tiempoEstimadoSeg, String descripcion) {
    }
}
