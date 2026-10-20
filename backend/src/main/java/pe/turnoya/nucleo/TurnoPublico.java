package pe.turnoya.nucleo;

import java.time.Instant;
import java.util.List;
import pe.turnoya.nucleo.puertos.AvisosDelTurno.AvisoEnviado;

/**
 * Estado de un turno tal como lo ve el cliente ({@code GET /api/v1/public/turnos/:token} y la página "mi turno").
 * Mismos campos que {@code obtenerTurnoPorToken} de legacy/.
 */
public record TurnoPublico(
        int id,
        String codigo,
        String codigoProvisional,
        String token,
        EstadoTurno estado,
        CanalTurno canal,
        int numero,
        int posicion,
        int personasDelante,
        int tiempoEstimadoSeg,
        Prediccion prediccion,
        Integer avisoMinAntes,
        int rellamadas,
        Instant emitidoAt,
        Instant avisadoAt,
        Instant llamadoAt,
        Instant finalizadoAt,
        String fecha,
        ColaResumen cola,
        VentanillaResumen ventanilla,
        ClienteResumen cliente,
        LocalPublico local,
        Redireccion redirigidoA,
        List<LlamandoAhora> llamandoAhora,
        List<AvisoEnviado> notificaciones,
        String urlSeguimiento) {

    public boolean enEspera() {
        return estado.enEspera();
    }

    public boolean llamado() {
        return estado == EstadoTurno.LLAMADO;
    }

    public boolean finalizado() {
        return estado.finalizado();
    }

    /** Avance para la barra de progreso (8–100 %), misma fórmula que legacy/. */
    public int progreso() {
        if (!enEspera()) {
            return 100;
        }
        return Math.max(8, (int) Math.round(100 - (personasDelante / (double) (personasDelante + 3)) * 100));
    }

    public int minutosEstimados() {
        return tiempoEstimadoSeg < 60 ? 0 : Math.round(tiempoEstimadoSeg / 60f);
    }

    public record Prediccion(int segundos, int loSeg, int hiSeg, double confianza, String modelo, boolean enfrio, int p50Min, int p90Min) {
    }

    public record ColaResumen(int id, String nombre, String prefijo, int tiempoAtencionBase) {
    }

    public record VentanillaResumen(int id, String nombre) {
    }

    public record ClienteResumen(String nombre, String telefonoMasc) {
    }

    public record LocalPublico(int id, String slug, String nombreComercial, String colorPrimario, String logoUrl, String direccion,
                               int avisarFaltando) {
    }

    public record Redireccion(String token, String codigo, String cola) {
    }

    public record LlamandoAhora(String codigo, String codigoProvisional, String ventanilla) {
    }
}
