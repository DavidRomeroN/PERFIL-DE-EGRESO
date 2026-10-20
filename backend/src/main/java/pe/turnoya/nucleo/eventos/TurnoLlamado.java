package pe.turnoya.nucleo.eventos;

/** Una ventanilla llamó (o rellamó) a un turno: la TV lo anuncia y el cliente recibe el aviso. */
public record TurnoLlamado(int localId, int turnoId, String codigo, String token, String ventanilla, String cola,
                           boolean rellamada, String codigoProvisional) {
}
