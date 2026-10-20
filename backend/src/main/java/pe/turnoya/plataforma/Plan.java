package pe.turnoya.plataforma;

import java.math.BigDecimal;

/** Plan contratado: límites de uso (RN05) y si incluye avisos por WhatsApp. */
public record Plan(
        int id,
        String codigo,
        String nombre,
        BigDecimal precioMensual,
        int maxTurnosMes,
        int maxColas,
        int maxVentanillas,
        boolean whatsappHabilitado,
        int maxAvisosWhatsapp,
        boolean reportes) {
}
