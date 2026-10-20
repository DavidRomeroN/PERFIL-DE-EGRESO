package pe.turnoya.nucleo;

/**
 * Estados del turno y sus transiciones válidas (diagrama de la sección 8.6). M6 agrega TRANSFERIDO también desde
 * LLAMADO (RN-M6-01). Cualquier otra transición la rechaza la API con 409 {@code TRANSICION_INVALIDA}.
 */
public enum EstadoTurno {
    EMITIDO("En espera"),
    AVISADO("Avisado"),
    LLAMADO("Llamado"),
    ATENDIDO("Atendido"),
    NO_SE_PRESENTO("No se presentó"),
    CANCELADO("Cancelado"),
    TRANSFERIDO("Transferido");

    private final String etiqueta;

    EstadoTurno(String etiqueta) {
        this.etiqueta = etiqueta;
    }

    public String etiqueta() {
        return etiqueta;
    }

    public boolean puedePasarA(EstadoTurno destino) {
        return switch (this) {
            case EMITIDO -> destino == AVISADO || destino == LLAMADO || destino == CANCELADO || destino == TRANSFERIDO;
            case AVISADO -> destino == LLAMADO || destino == CANCELADO || destino == TRANSFERIDO;
            case LLAMADO -> destino == LLAMADO || destino == ATENDIDO || destino == NO_SE_PRESENTO || destino == TRANSFERIDO;
            case ATENDIDO, NO_SE_PRESENTO, CANCELADO, TRANSFERIDO -> false;
        };
    }

    /** En la fila, todavía sin llamar. */
    public boolean enEspera() {
        return this == EMITIDO || this == AVISADO;
    }

    /** Ocupa lugar: en espera o llamado (RN03: un cliente solo puede tener uno activo por cola). */
    public boolean activo() {
        return enEspera() || this == LLAMADO;
    }

    public boolean finalizado() {
        return !activo();
    }
}
