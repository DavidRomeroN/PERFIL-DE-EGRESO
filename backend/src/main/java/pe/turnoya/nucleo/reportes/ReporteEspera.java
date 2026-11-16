package pe.turnoya.nucleo.reportes;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import pe.turnoya.nucleo.CanalTurno;
import pe.turnoya.nucleo.EstadoTurno;

/** Reporte de espera de un rango de fechas (mismo formato que {@code reporteEspera} del sistema anterior). */
public record ReporteEspera(Rango rango, Resumen resumen, List<PorDia> porDia, List<PorHora> porHora, List<PorCola> porCola,
                            List<PorEstado> porEstado, List<PorCanal> porCanal, List<Detalle> detalle) {

    public record Rango(LocalDate desde, LocalDate hasta) {
    }

    public record Resumen(int total, int atendidos, int noPresentados, int cancelados, double tasaAbandono, int pctQR,
                          double esperaPromMin, double esperaMaxMin, double atencionPromMin) {
    }

    public record PorDia(LocalDate fecha, int turnos, int atendidos, int abandonos, double esperaPromMin) {
    }

    public record PorHora(int hora, String etiqueta, int turnos, double esperaPromMin) {
    }

    public record PorCola(String cola, String prefijo, int turnos, int atendidos, int abandonos, double tasaAbandono,
                          double esperaPromMin, double atencionPromMin) {
    }

    public record PorEstado(EstadoTurno estado, int cantidad) {
    }

    /** Turnos por canal: muestra cuánto se usa la app, WhatsApp, el QR web y el ticket. */
    public record PorCanal(CanalTurno canal, int cantidad, int porcentaje) {
    }

    public record Detalle(int id, LocalDate fecha, String codigo, String cola, EstadoTurno estado, CanalTurno canal, String ventanilla,
                          Instant emitidoAt, Instant llamadoAt, Instant finalizadoAt, Double esperaMin, Double atencionMin) {
    }

    /** Mayor valor de turnos por día (para escalar las barras de los gráficos). */
    public int maxTurnosDia() {
        return Math.max(1, porDia.stream().mapToInt(PorDia::turnos).max().orElse(0));
    }

    public int maxTurnosHora() {
        return Math.max(1, porHora.stream().mapToInt(PorHora::turnos).max().orElse(0));
    }

    /** Mayor espera promedio diaria en minutos (escala del gráfico de espera por día). */
    public double maxEsperaDia() {
        return Math.max(1, porDia.stream().mapToDouble(PorDia::esperaPromMin).max().orElse(0));
    }

    public int maxCanal() {
        return Math.max(1, porCanal.stream().mapToInt(PorCanal::cantidad).max().orElse(0));
    }
}
