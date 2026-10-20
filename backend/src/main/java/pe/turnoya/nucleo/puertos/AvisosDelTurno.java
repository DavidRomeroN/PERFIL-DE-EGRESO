package pe.turnoya.nucleo.puertos;

import java.time.Instant;
import java.util.List;

/** Avisos (WhatsApp o web) enviados a un turno, para mostrarlos en "mi turno". Lo implementa notificaciones. */
public interface AvisosDelTurno {

    List<AvisoEnviado> deTurno(int turnoId);

    record AvisoEnviado(int id, String tipo, String destino, String mensaje, String estado, Instant enviadoAt, Instant createdAt) {
    }
}
