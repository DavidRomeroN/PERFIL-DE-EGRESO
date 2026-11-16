package pe.turnoya.plataforma.dominio;

/** Franja de atención de un día de la semana (0 = domingo), con horas {@code HH:mm} en la zona del local. */
public record Horario(int diaSemana, String apertura, String cierre) {
}
