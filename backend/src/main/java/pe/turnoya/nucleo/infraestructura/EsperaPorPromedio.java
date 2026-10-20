package pe.turnoya.nucleo.infraestructura;

import pe.turnoya.nucleo.puertos.EstimadorEspera;

/**
 * Estimador por defecto (RN02): función SQL {@code tiempo_estimado} = posición × promedio de los últimos 10
 * atendidos de la cola (o el tiempo base si aún no hay histórico). Se usa cuando ningún módulo da otro estimador.
 */
public class EsperaPorPromedio implements EstimadorEspera {

    private final TurnosJdbc turnos;

    public EsperaPorPromedio(TurnosJdbc turnos) {
        this.turnos = turnos;
    }

    @Override
    public boolean aplica(int localId) {
        return true;
    }

    @Override
    public Estimacion estimar(int colaId, int posicion) {
        return Estimacion.de(posicion < 1 ? 0 : turnos.tiempoEstimadoBase(colaId, posicion));
    }
}
