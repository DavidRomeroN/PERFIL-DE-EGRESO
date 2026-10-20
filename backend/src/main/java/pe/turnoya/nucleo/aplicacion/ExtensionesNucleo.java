package pe.turnoya.nucleo.aplicacion;

import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import pe.turnoya.nucleo.OrigenCategoria;
import pe.turnoya.nucleo.infraestructura.EsperaPorPromedio;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc;
import pe.turnoya.nucleo.puertos.AvisosDelTurno;
import pe.turnoya.nucleo.puertos.EstimadorEspera;
import pe.turnoya.nucleo.puertos.OfertaCitas;
import pe.turnoya.nucleo.puertos.PoliticaPrioridad;

/**
 * Elige, para cada local, qué implementación de cada puerto usar: la primera que {@code aplica} (por ejemplo, la de
 * M2 si el módulo está encendido) o el comportamiento original del núcleo. Ningún caso de uso pregunta
 * "¿está M2 activo?": esa decisión vive solo aquí.
 */
@Component
public class ExtensionesNucleo {

    private final ObjectProvider<PoliticaPrioridad> politicas;
    private final ObjectProvider<EstimadorEspera> estimadores;
    private final ObjectProvider<OfertaCitas> ofertas;
    private final ObjectProvider<AvisosDelTurno> avisos;
    private final EstimadorEspera esperaPorPromedio;

    ExtensionesNucleo(ObjectProvider<PoliticaPrioridad> politicas, ObjectProvider<EstimadorEspera> estimadores,
                      ObjectProvider<OfertaCitas> ofertas, ObjectProvider<AvisosDelTurno> avisos, TurnosJdbc turnos) {
        this.politicas = politicas;
        this.estimadores = estimadores;
        this.ofertas = ofertas;
        this.avisos = avisos;
        this.esperaPorPromedio = new EsperaPorPromedio(turnos);
    }

    /** Categoría de prioridad del turno, o vacío (turno general / M1 apagado). */
    public Optional<PoliticaPrioridad.CategoriaAsignada> categoria(int localId, String codigo, OrigenCategoria origen) {
        return politicas.orderedStream().filter(p -> p.aplica(localId)).findFirst()
                .flatMap(p -> p.resolver(localId, codigo, origen));
    }

    public List<PoliticaPrioridad.CategoriaCliente> categoriasParaCliente(int localId) {
        return politicas.orderedStream().filter(p -> p.aplica(localId)).findFirst()
                .map(p -> p.categoriasParaCliente(localId)).orElse(List.of());
    }

    public EstimadorEspera.Estimacion estimar(int localId, int colaId, int posicion) {
        if (posicion < 1) {
            return EstimadorEspera.Estimacion.de(0);
        }
        return estimadores.orderedStream().filter(e -> e.aplica(localId)).findFirst().orElse(esperaPorPromedio)
                .estimar(colaId, posicion);
    }

    public int segundosDeEspera(int localId, int colaId, int posicion) {
        return estimar(localId, colaId, posicion).segundos();
    }

    public boolean ofreceCitas(int localId) {
        return ofertas.orderedStream().anyMatch(o -> o.localConCitas(localId));
    }

    public boolean colaConCitas(int colaId) {
        return ofertas.orderedStream().anyMatch(o -> o.colaConCitas(colaId));
    }

    public List<AvisosDelTurno.AvisoEnviado> avisos(int turnoId) {
        return avisos.orderedStream().findFirst().map(a -> a.deTurno(turnoId)).orElse(List.of());
    }
}
