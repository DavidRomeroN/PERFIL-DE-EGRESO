package pe.turnoya.nucleo;

import java.time.Instant;
import java.util.List;

/**
 * Foto del local en este momento: colas, quién espera, quién está siendo atendido y métricas del día.
 * La usan la pantalla TV (sin datos personales) y el panel de ventanilla (con nombres y categoría).
 * Mismo formato que {@code snapshotLocal} de legacy/, salvo que la versión pública ya no incluye los tokens de
 * seguimiento de cada turno (con ellos cualquiera podía cancelar turnos ajenos).
 */
public record SnapshotLocal(
        LocalInfo local,
        String fecha,
        List<VentanillaInfo> ventanillas,
        List<ColaInfo> colas,
        List<UltimoLlamado> ultimosLlamados,
        Estadisticas stats,
        Instant generadoAt) {

    public record LocalInfo(int id, String slug, String nombreComercial, String direccion, String colorPrimario, String logoUrl,
                            String mensajeTv, String mensajeBienvenida, PlanInfo plan, int avisarFaltando, Integer tiempoAusenciaSeg) {
    }

    public record PlanInfo(String codigo, String nombre, boolean whatsappHabilitado) {
    }

    public record VentanillaInfo(int id, String nombre, ColaCorta cola) {
    }

    public record ColaCorta(int id, String nombre, String prefijo) {
    }

    public record ColaInfo(int id, String nombre, String prefijo, String descripcion, List<VentanillaCorta> ventanillas,
                           int enEspera, int tiempoEstimadoSeg, double esperaPromedioMin, List<EnEspera> espera, List<Llamado> llamados) {
    }

    public record VentanillaCorta(int id, String nombre) {
    }

    public record EnEspera(int id, String codigo, String codigoProvisional, String token, EstadoTurno estado, CanalTurno canal,
                           Instant emitidoAt, int posicion, String nombre, String categoria, String categoriaCodigo,
                           Boolean prioridadVerificada) {
    }

    public record Llamado(int id, String codigo, String codigoProvisional, String token, String ventanilla, Integer ventanillaId,
                          Instant llamadoAt, int rellamadas, String nombre) {
    }

    public record UltimoLlamado(int id, String codigo, String codigoProvisional, String ventanilla, EstadoTurno estado, Instant llamadoAt) {
    }

    public record Estadisticas(int total, int atendidos, int noPresentados, int cancelados, int enEspera, int llamados, int porQR,
                               int pctQR, double tasaAbandono, double esperaPromedioMin, double atencionPromedioMin) {
    }
}
