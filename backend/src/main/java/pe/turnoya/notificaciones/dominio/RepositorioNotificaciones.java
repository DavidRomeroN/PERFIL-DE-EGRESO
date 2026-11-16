package pe.turnoya.notificaciones.dominio;

import java.time.Instant;
import java.util.List;
import pe.turnoya.nucleo.puertos.AvisosDelTurno.AvisoEnviado;

/** Puerto de salida: Avisos enviados o por enviar (tabla notificacion). Lo implementa {@code infraestructura.NotificacionesJdbc}. */
public interface RepositorioNotificaciones {

    /** Avisos por WhatsApp del mes que cuentan para el cupo del plan (los mensajes del antiguo chatbot no cuentan). */
    int usadosDesde(int localId, Instant inicioMes);

    int registrar(int localId, Integer turnoId, Integer citaId, String tipo, String destino, String mensaje, String plantilla, String estado, Instant enviadoAt, String error);

    void marcarEnviado(int id, String proveedorMsgId, Instant ahora);

    void marcarFallido(int id, String error);

    void cambiarEstado(int id, String estado);

    List<AvisoEnviado> deTurno(int turnoId);

    /** Bandeja de salida del local: los avisos más recientes con el turno y la cola. */
    java.util.List<AvisoBandeja> bandeja(int localId, int limite);

    /** Cantidad de avisos de WhatsApp del local por estado (PENDIENTE, ENVIADO, ENTREGADO, LEIDO, FALLIDO). */
    java.util.Map<String, Integer> resumenWhatsApp(int localId);

    record AvisoBandeja(int id, String tipo, String destino, String mensaje, String plantilla, String estado, String error, Instant createdAt,
                        String codigo, String cola, String cliente) {
    }
}
