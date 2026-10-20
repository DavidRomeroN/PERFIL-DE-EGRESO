package pe.turnoya.nucleo.aplicacion;

import java.time.Instant;
import pe.turnoya.nucleo.CanalTurno;
import pe.turnoya.nucleo.OrigenCategoria;

/**
 * Datos para emitir un turno. Los campos opcionales los usan otros canales (cita, kiosco, transferencia); para el
 * cliente por QR y el ticket impreso basta con {@link #porQr} y {@link #ticket}.
 */
public record SolicitudEmision(
        int colaId,
        CanalTurno canal,
        String nombre,
        String telefono,
        boolean consentimiento,
        String categoriaCodigo,
        OrigenCategoria origenCategoria,
        Integer clienteId,
        Instant emitidoAt,
        Integer citaId,
        Integer dispositivoId,
        String codigoProvisional,
        Integer transferidoDe,
        boolean omitirHorario,
        boolean omitirLimitePlan) {

    public static SolicitudEmision porQr(int colaId, String nombre, String telefono, boolean consentimiento, String categoria) {
        return new SolicitudEmision(colaId, CanalTurno.QR, nombre, telefono, consentimiento, categoria, null, null, null,
                null, null, null, null, false, false);
    }

    public static SolicitudEmision ticket(int colaId, String nombre, String categoria) {
        return new SolicitudEmision(colaId, CanalTurno.TICKET, nombre, null, false, categoria, OrigenCategoria.PERSONAL,
                null, null, null, null, null, null, false, false);
    }

    OrigenCategoria origen() {
        return origenCategoria != null ? origenCategoria : canal.origenCategoria();
    }
}
