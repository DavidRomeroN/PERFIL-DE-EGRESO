package pe.turnoya.nucleo;

/** Por dónde se emitió el turno. */
public enum CanalTurno {
    QR("por QR"),
    TICKET("ticket impreso"),
    WHATSAPP("por WhatsApp"),
    KIOSCO("en el kiosco"),
    CITA("por cita");

    private final String etiqueta;

    CanalTurno(String etiqueta) {
        this.etiqueta = etiqueta;
    }

    public String etiqueta() {
        return etiqueta;
    }

    /** Quién declara la categoría de prioridad según el canal (M1). */
    public OrigenCategoria origenCategoria() {
        return switch (this) {
            case TICKET -> OrigenCategoria.PERSONAL;
            case CITA -> OrigenCategoria.CITA;
            default -> OrigenCategoria.CLIENTE;
        };
    }
}
