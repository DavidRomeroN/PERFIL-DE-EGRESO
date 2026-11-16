package pe.turnoya.kiosco;

/** Un kiosco dejó de enviar latidos (75 s). Lo escucha Analítica (M7) para la alerta KIOSCO_OFFLINE. */
public record KioscoSinConexion(int localId, int dispositivoId, String nombre) {
}
