package pe.turnoya.nucleo.atencion;

import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.nucleo.dominio.RepositorioTurnos;
import pe.turnoya.nucleo.dominio.RepositorioVentanillas;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.nucleo.dominio.Ventanilla;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.VentanillasDelOperador;

/**
 * Lo que puede tocar un operador desde el panel y la API: solo sus ventanillas, los turnos de sus colas y los tickets
 * impresos de esas colas. Los administradores no tienen restricción.
 */
@Component
public class AccesoVentanillas {

    private final VentanillasDelOperador asignaciones;
    private final RepositorioVentanillas ventanillas;
    private final RepositorioTurnos turnos;

    AccesoVentanillas(VentanillasDelOperador asignaciones, RepositorioVentanillas ventanillas, RepositorioTurnos turnos) {
        this.asignaciones = asignaciones;
        this.ventanillas = ventanillas;
        this.turnos = turnos;
    }

    /** Ventanillas permitidas; {@code null} = todas (administradores). */
    public Set<Integer> permitidas(Sesion sesion) {
        return asignaciones.asignadas(sesion).orElse(null);
    }

    public void exigirVentanilla(Sesion sesion, int ventanillaId) {
        Set<Integer> permitidas = permitidas(sesion);
        if (permitidas != null && !permitidas.contains(ventanillaId)) {
            throw sinPermiso("No tienes asignada esta ventanilla");
        }
    }

    /** Ticket impreso: solo para las colas de sus ventanillas. */
    public void exigirCola(Sesion sesion, int localId, int colaId) {
        Set<Integer> permitidas = permitidas(sesion);
        if (permitidas != null && !colasPermitidas(localId, permitidas).contains(colaId)) {
            throw sinPermiso("Solo puedes emitir tickets para la cola de tus ventanillas");
        }
    }

    /** Atender, rellamar o marcar "no se presentó": el turno debe estar en una de sus ventanillas o de sus colas. */
    public void exigirTurno(Sesion sesion, int localId, int turnoId) {
        Set<Integer> permitidas = permitidas(sesion);
        if (permitidas == null) {
            return;
        }
        Turno t = turnos.porIdEnLocal(turnoId, localId)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("TURNO_NO_ENCONTRADO", "El turno no existe"));
        boolean suyo = t.ventanillaId() != null ? permitidas.contains(t.ventanillaId()) : colasPermitidas(localId, permitidas).contains(t.colaId());
        if (!suyo) {
            throw sinPermiso("Ese turno no es de tus ventanillas");
        }
    }

    private Set<Integer> colasPermitidas(int localId, Set<Integer> permitidas) {
        return ventanillas.activasDelLocal(localId).stream()
                .filter(v -> permitidas.contains(v.id()) && v.colaId() != null)
                .map(Ventanilla::colaId)
                .collect(Collectors.toSet());
    }

    private static ErrorNegocio sinPermiso(String mensaje) {
        return new ErrorNegocio("SIN_PERMISO", mensaje, 403);
    }
}
