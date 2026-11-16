package pe.turnoya.simulador.dominio;

import java.util.List;

/**
 * Parámetros de un día simulado (JSON versionado §5.1 del documento de M8). Las horas van en "HH:mm"; los tramos de
 * llegadas y de ventanillas rigen desde su hora hasta el siguiente tramo.
 *
 * @param pacienciaMediaMin media exponencial de la paciencia; {@code null} = nadie abandona
 * @param noShow            probabilidad de que el llamado no se presente y minutos que pierde la ventanilla; {@code null} = sin no-show
 * @param costos            {@code null} = no se calcula el costo
 */
public record ParametrosSimulacion(String apertura, String cierre, List<Tramo> lambdaPorHora, Servicio servicio, List<TramoVentanillas> ventanillas,
                                   Double pacienciaMediaMin, NoShow noShow, double slaEsperaMaxMin, double slaObjetivoPct, Costos costos,
                                   int replicas, int semilla) {

    public ParametrosSimulacion {
        lambdaPorHora = List.copyOf(lambdaPorHora);
        ventanillas = List.copyOf(ventanillas);
    }

    /** Llegadas por hora desde una hora del día. */
    public record Tramo(String desde, double valor) {
    }

    public record TramoVentanillas(String desde, int c) {
    }

    public enum TipoServicio { EXPONENCIAL, LOGNORMAL, EMPIRICA }

    /** Tiempo de atención: media y coeficiente de variación, o muestras reales (empírica). */
    public record Servicio(TipoServicio tipo, double mediaMin, double cv, List<Double> muestras) {

        public Servicio {
            muestras = muestras == null ? List.of() : List.copyOf(muestras);
        }

        Servicio escalar(double f) {
            return new Servicio(tipo, mediaMin * f, cv, muestras.stream().map(m -> m * f).toList());
        }
    }

    public record NoShow(double p, double minutos) {
    }

    public record Costos(double ventanillaHora, double esperaMinuto) {
    }

    public ParametrosSimulacion conReplicas(int r) {
        return new ParametrosSimulacion(apertura, cierre, lambdaPorHora, servicio, ventanillas, pacienciaMediaMin, noShow, slaEsperaMaxMin,
                slaObjetivoPct, costos, r, semilla);
    }

    /** Mismo escenario con el horario, las llegadas y las ventanillas de un día real (backtest). */
    public ParametrosSimulacion conDia(String abre, String cierra, List<Tramo> llegadas, List<TramoVentanillas> vent, int r) {
        return new ParametrosSimulacion(abre, cierra, llegadas, servicio, vent, pacienciaMediaMin, noShow, slaEsperaMaxMin, slaObjetivoPct, costos, r, semilla);
    }

    ParametrosSimulacion escalarLlegadas(double f) {
        return new ParametrosSimulacion(apertura, cierre, lambdaPorHora.stream().map(t -> new Tramo(t.desde(), t.valor() * f)).toList(), servicio,
                ventanillas, pacienciaMediaMin, noShow, slaEsperaMaxMin, slaObjetivoPct, costos, replicas, semilla);
    }

    ParametrosSimulacion escalarServicio(double f) {
        return new ParametrosSimulacion(apertura, cierre, lambdaPorHora, servicio.escalar(f), ventanillas, pacienciaMediaMin, noShow, slaEsperaMaxMin,
                slaObjetivoPct, costos, replicas, semilla);
    }

    ParametrosSimulacion sumarVentanillas(int d) {
        return new ParametrosSimulacion(apertura, cierre, lambdaPorHora, servicio,
                ventanillas.stream().map(v -> new TramoVentanillas(v.desde(), Math.max(1, v.c() + d))).toList(), pacienciaMediaMin, noShow,
                slaEsperaMaxMin, slaObjetivoPct, costos, replicas, semilla);
    }
}
